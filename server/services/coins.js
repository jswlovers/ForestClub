const crypto = require('node:crypto');
const db = require('../db');

class InsufficientCoinsError extends Error {
  constructor() {
    super('코인이 부족해요');
    this.name = 'InsufficientCoinsError';
  }
}

const insertEntry = db.prepare(`
  INSERT INTO coin_ledger (transaction_group, account, direction, amount, user_id, type, note)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const balanceStmt = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0) AS balance
  FROM coin_ledger WHERE account = ?
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
    insertEntry.run(group, e.account, e.direction, e.amount, e.userId ?? null, e.type, e.note ?? null);
  }
  return group;
}

function getBalance(userId) {
  return balanceStmt.get(userAccount(userId)).balance;
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

/** 코인 충전 승인: 플랫폼 현금 계정 차변, 회원 코인 계정 대변. */
function creditCoins(userId, amount, type, note) {
  return postEntries([
    { account: 'platform:cash', direction: 'debit', amount, type, note },
    { account: userAccount(userId), direction: 'credit', amount, userId, type, note },
  ]);
}

/** 코인 사용(메시지 발송 등): 회원 코인 계정 차변, 플랫폼 매출 계정 대변. 잔액 부족 시 예외. */
function debitCoins(userId, amount, type, note) {
  if (getBalance(userId) < amount) throw new InsufficientCoinsError();
  return postEntries([
    { account: userAccount(userId), direction: 'debit', amount, userId, type, note },
    { account: 'platform:revenue', direction: 'credit', amount, type, note },
  ]);
}

module.exports = {
  InsufficientCoinsError,
  getBalance,
  getAllBalances,
  getUserLedger,
  getRecentLedger,
  creditCoins,
  debitCoins,
};
