const crypto = require('node:crypto');
const db = require('../db');

class InsufficientCoinsError extends Error {
  constructor() {
    super('코인이 부족해요');
    this.name = 'InsufficientCoinsError';
  }
}

const insertEntry = db.prepare(`
  INSERT INTO coin_ledger (transaction_group, account, direction, amount, user_id, type, note, coin_type)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const balanceStmt = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS balance
  FROM coin_ledger WHERE account = ?
`);

// 무료/유료 코인은 같은 계정(account) 안에서 coin_type으로만 구분된다 — 회원에게는 "코인"이라는
// 하나의 잔액으로 보이지만(이용약관 제13조2항: 사용 조건은 동일), 내부적으로는 소진 순서(무료 우선)와
// 환불 대상 여부(무료 코인은 환불 불가, 제16조3항)를 가르기 위해 분리해서 집계한다.
const balanceByTypeStmt = db.prepare(`
  SELECT coin_type, COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS balance
  FROM coin_ledger WHERE account = ? GROUP BY coin_type
`);

// 모임 참석 확정 시 "보류"로 묶여 당장은 쓸 수 없는 코인의 합(원장은 건드리지 않음 — event_attendances 참고).
const heldStmt = db.prepare(`
  SELECT COALESCE(SUM(hold_coins), 0) AS held FROM event_attendances WHERE user_id = ? AND status = 'confirmed'
`);

const allBalancesStmt = db.prepare(`
  SELECT user_id,
         SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS balance
  FROM coin_ledger
  WHERE account LIKE 'user:%'
  GROUP BY user_id
`);

const userLedgerStmt = db.prepare(`
  SELECT id, transaction_group, direction, amount, type, note, created_at
  FROM coin_ledger WHERE account = ?
  ORDER BY id DESC LIMIT 200
`);

const recentLedgerStmt = db.prepare(`
  SELECT cl.id, cl.transaction_group, cl.account, cl.direction, cl.amount, cl.type, cl.note, cl.created_at, u.name AS user_name
  FROM coin_ledger cl
  LEFT JOIN users u ON u.id = cl.user_id
  ORDER BY cl.id DESC LIMIT 200
`);

function userAccount(userId) {
  return `user:${userId}`;
}

/** 거래 하나를 이루는 차변/대변 항목들을 원장에 기록한다. 대차가 맞지 않으면 기록하지 않는다. */
function postEntries(entries) {
  const debit = entries.filter((e) => e.direction === 'debit').reduce((s, e) => s + e.amount, 0);
  const credit = entries.filter((e) => e.direction === 'credit').reduce((s, e) => s + e.amount, 0);
  if (debit !== credit || debit <= 0) {
    throw new Error('원장 항목의 차변/대변 합이 일치하지 않아요');
  }
  const group = crypto.randomUUID();
  for (const e of entries) {
    insertEntry.run(group, e.account, e.direction, e.amount, e.userId ?? null, e.type, e.note ?? null, e.coinType || 'paid');
  }
  return group;
}

function getBalance(userId) {
  return balanceStmt.get(userAccount(userId)).balance;
}

function getBalanceBreakdown(userId) {
  const rows = balanceByTypeStmt.all(userAccount(userId));
  const free = rows.find((r) => r.coin_type === 'free')?.balance || 0;
  const paid = rows.find((r) => r.coin_type === 'paid')?.balance || 0;
  const held = heldStmt.get(userId).held;
  return { free, paid, total: free + paid, held, available: free + paid - held };
}

/** 모임 참석 확정 등으로 "보류"돼 지금 당장은 못 쓰는 코인을 뺀, 실제로 쓸 수 있는 잔액. */
function getAvailableBalance(userId) {
  return getBalance(userId) - heldStmt.get(userId).held;
}

function getAllBalances() {
  const rows = allBalancesStmt.all();
  const map = new Map();
  rows.forEach((r) => map.set(r.user_id, r.balance));
  return map;
}

function getUserLedger(userId) {
  return userLedgerStmt.all(userAccount(userId));
}

function getRecentLedger() {
  return recentLedgerStmt.all();
}

/** 코인 충전 승인(실제 입금): 플랫폼 현금 계정 차변, 회원 코인 계정 대변(coin_type='paid'). */
function creditCoins(userId, amount, type, note) {
  return postEntries([
    { account: 'platform:cash', direction: 'debit', amount, type, note, coinType: 'paid' },
    { account: userAccount(userId), direction: 'credit', amount, userId, type, note, coinType: 'paid' },
  ]);
}

/**
 * 무료 코인 지급(웰컴/출석 등, 이용약관 제13조3항): 실제 현금이 들어온 게 아니므로 platform:cash가 아닌
 * platform:marketing_cost에서 차변을 잡는다. 환불 대상이 아니고(제16조3항), 사용 시 유료 코인보다 먼저 차감된다.
 */
function creditFreeCoins(userId, amount, type, note) {
  return postEntries([
    { account: 'platform:marketing_cost', direction: 'debit', amount, type, note, coinType: 'free' },
    { account: userAccount(userId), direction: 'credit', amount, userId, type, note, coinType: 'free' },
  ]);
}

/**
 * 코인 사용(메시지 발송, 통화, 모임 몰수 등): 무료 코인을 먼저 소진하고 부족분만 유료 코인에서 차감한다
 * (이용약관 제14조2항). 무료 코인 소진분은 실제 매출이 아니므로 platform:free_coin_used로,
 * 유료 코인 소진분만 platform:revenue로 대변 처리해 원장에서 실매출과 구분할 수 있게 한다.
 */
function debitCoins(userId, amount, type, note) {
  const { free, paid } = getBalanceBreakdown(userId);
  // 모임 참석 확정으로 보류된 코인은 다른 용도(쪽지/통화 등)로 쓸 수 없어야 "보류"라는 말이 의미가 있다.
  // 그래서 메시지/통화 소비뿐 아니라, 모든 debitCoins 호출은 원장 총액이 아니라 available(=총액-보류)만큼만 허용한다.
  // 몰수 처리(resolveAttendance)는 이 보류를 먼저 해제한 뒤에 debitCoins를 호출하므로 그 자신은 막히지 않는다.
  if (getAvailableBalance(userId) < amount) throw new InsufficientCoinsError();

  const freePortion = Math.min(free, amount);
  const paidPortion = amount - freePortion;

  const entries = [];
  if (freePortion > 0) {
    entries.push({ account: userAccount(userId), direction: 'debit', amount: freePortion, userId, type, note, coinType: 'free' });
    entries.push({ account: 'platform:free_coin_used', direction: 'credit', amount: freePortion, type, note, coinType: 'free' });
  }
  if (paidPortion > 0) {
    entries.push({ account: userAccount(userId), direction: 'debit', amount: paidPortion, userId, type, note, coinType: 'paid' });
    entries.push({ account: 'platform:revenue', direction: 'credit', amount: paidPortion, type, note, coinType: 'paid' });
  }
  return postEntries(entries);
}

module.exports = {
  InsufficientCoinsError,
  getBalance,
  getBalanceBreakdown,
  getAvailableBalance,
  getAllBalances,
  getUserLedger,
  getRecentLedger,
  creditCoins,
  creditFreeCoins,
  debitCoins,
};
