const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { getBalance, getUserLedger, creditCoins } = require('../services/coins');
const { confirmTossPayment } = require('../services/payment');
const { notifyBySms } = require('../services/notify');
const { rateLimit } = require('../rate-limit');

const router = express.Router();
router.use(requireAuth);

const COIN_PER_KRW = 1; // 1코인 = 1원
const MIN_CHARGE_KRW = 1000;

const insertCharge = db.prepare(`
  INSERT INTO coin_charges (user_id, amount_krw, coins, provider, provider_order_id)
  VALUES (?, ?, ?, ?, ?)
`);
const myCharges = db.prepare(`
  SELECT id, amount_krw, coins, status, provider, admin_note, created_at, processed_at
  FROM coin_charges WHERE user_id = ? ORDER BY created_at DESC
`);
const getChargeByOrderId = db.prepare(`SELECT * FROM coin_charges WHERE provider_order_id = ?`);
const markChargeProcessed = db.prepare(`
  UPDATE coin_charges SET status = ?, provider_response = ?, processed_at = datetime('now') WHERE id = ?
`);

const chargeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: '충전 요청이 너무 많아요. 잠시 후 다시 시도해주세요' });

router.get('/balance', (req, res) => {
  res.json({ coins: getBalance(req.user.id) });
});

router.get('/ledger', (req, res) => {
  res.json(getUserLedger(req.user.id));
});

router.post('/charge-requests', chargeLimiter, (req, res) => {
  const amountKrw = Math.floor(Number(req.body.amountKrw));
  const provider = req.body.provider === 'toss' ? 'toss' : 'manual';
  if (!Number.isFinite(amountKrw) || amountKrw < MIN_CHARGE_KRW) {
    return res.status(400).json({ error: `최소 ${MIN_CHARGE_KRW.toLocaleString()}원부터 충전할 수 있어요` });
  }
  const coins = amountKrw * COIN_PER_KRW;
  const orderId = `${provider}-${Date.now()}-${req.user.id}`;
  const info = insertCharge.run(req.user.id, amountKrw, coins, provider, orderId);
  res.status(201).json({ id: info.lastInsertRowid, orderId, amountKrw, coins, status: 'pending', provider });
});

router.get('/charge-requests/me', (req, res) => {
  res.json(myCharges.all(req.user.id));
});

// 토스페이먼츠 위젯 결제 완료 후 클라이언트가 호출하는 승인 엔드포인트.
// TOSS_SECRET_KEY가 없으면 아직 연동 전이므로 관리자 수동승인을 이용하도록 안내한다.
router.post('/toss/confirm', async (req, res) => {
  const { orderId, paymentKey, amount } = req.body || {};
  const charge = orderId && getChargeByOrderId.get(String(orderId));
  if (!charge || charge.user_id !== req.user.id) {
    return res.status(404).json({ error: '충전 요청을 찾을 수 없어요' });
  }
  if (charge.status !== 'pending') {
    return res.status(409).json({ error: '이미 처리된 요청이에요' });
  }
  if (Number(amount) !== charge.amount_krw) {
    return res.status(400).json({ error: '결제 금액이 일치하지 않아요' });
  }

  const result = await confirmTossPayment({ paymentKey, orderId, amount: charge.amount_krw });
  if (!result.configured) {
    return res.status(501).json({ error: '토스페이먼츠 연동이 아직 설정되지 않았어요. 관리자 수동승인을 이용해주세요' });
  }
  if (!result.ok) {
    markChargeProcessed.run('rejected', JSON.stringify(result.response), charge.id);
    return res.status(402).json({ error: '결제 승인에 실패했어요' });
  }

  creditCoins(charge.user_id, charge.coins, 'purchase', `토스페이먼츠 결제 (주문번호 ${orderId})`);
  markChargeProcessed.run('approved', JSON.stringify(result.response), charge.id);
  notifyBySms(
    req.user.id,
    req.user.phone,
    `[포레스트클럽] ${charge.coins.toLocaleString()}코인이 충전됐어요.`,
    { kind: 'coin_charge_approved', variables: { coins: String(charge.coins) } }
  ).catch((err) => console.error('[notify] coin charge sms failed', err));

  res.json({ ok: true, coins: getBalance(req.user.id) });
});

module.exports = router;
