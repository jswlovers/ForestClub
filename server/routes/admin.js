const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { notifyBySms } = require('../services/notify');
const { creditCoins, getRecentLedger } = require('../services/coins');

const router = express.Router();
router.use(requireAdmin);

const listUsers = db.prepare(`
  SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at,
    COALESCE((
      SELECT SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END)
      FROM coin_ledger WHERE account = 'user:' || u.id
    ), 0) AS coins
  FROM users u ORDER BY u.created_at DESC
`);
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');

const listApplications = db.prepare(`
  SELECT * FROM applications ORDER BY created_at DESC
`);

const getApplication = db.prepare('SELECT * FROM applications WHERE id = ?');
const updateApplicationStatus = db.prepare('UPDATE applications SET status = ?, admin_note = ? WHERE id = ?');

const listCompanions = db.prepare(`
  SELECT cr.id, cr.event_name, cr.message, cr.status, cr.created_at,
         req.name AS requester_name, tgt.name AS target_name
  FROM companion_requests cr
  JOIN users req ON req.id = cr.requester_id
  JOIN users tgt ON tgt.id = cr.target_id
  ORDER BY cr.created_at DESC
`);

const listEventInterests = db.prepare(`
  SELECT ei.id, ei.event_name, ei.created_at, u.name AS user_name, u.email AS user_email
  FROM event_interests ei
  LEFT JOIN users u ON u.id = ei.user_id
  ORDER BY ei.created_at DESC
`);

const listNotifications = db.prepare(`
  SELECT n.id, n.phone, n.channel, n.message, n.status, n.created_at, u.name AS user_name
  FROM notifications n
  LEFT JOIN users u ON u.id = n.user_id
  ORDER BY n.created_at DESC
  LIMIT 200
`);

router.get('/users', (req, res) => {
  res.json(listUsers.all());
});

router.get('/applications', (req, res) => {
  res.json(listApplications.all());
});

router.post('/applications/:id/approve', async (req, res) => {
  const application = getApplication.get(Number(req.params.id));
  if (!application) return res.status(404).json({ error: '지원서를 찾을 수 없어요' });
  if (application.status !== 'pending') return res.status(409).json({ error: '이미 처리된 지원서예요' });
  const note = String(req.body?.note || '').trim();
  updateApplicationStatus.run('approved', note || null, application.id);
  notifyBySms(
    application.user_id,
    application.phone,
    `[포레스트클럽] ${application.name}님, 멤버십 승인을 축하드립니다! 웰컴 라운딩 일정을 곧 안내드리겠습니다.`,
    { kind: 'application_approved', variables: { name: application.name } }
  ).catch((err) => console.error('[notify] approve sms failed', err));
  res.json({ ok: true });
});

router.post('/applications/:id/reject', async (req, res) => {
  const application = getApplication.get(Number(req.params.id));
  if (!application) return res.status(404).json({ error: '지원서를 찾을 수 없어요' });
  if (application.status !== 'pending') return res.status(409).json({ error: '이미 처리된 지원서예요' });
  const reason = String(req.body?.reason || '').trim();
  updateApplicationStatus.run('rejected', reason || null, application.id);
  notifyBySms(
    application.user_id,
    application.phone,
    `[포레스트클럽] ${application.name}님, 이번 기수 심사 결과 아쉽게도 함께하지 못하게 되었습니다.${reason ? ` (사유: ${reason})` : ''} 다음 모집 시 다시 지원해주세요.`,
    { kind: 'application_rejected', variables: { name: application.name, reason } }
  ).catch((err) => console.error('[notify] reject sms failed', err));
  res.json({ ok: true });
});

router.get('/companions', (req, res) => {
  res.json(listCompanions.all());
});

router.get('/event-interests', (req, res) => {
  res.json(listEventInterests.all());
});

router.get('/notifications', (req, res) => {
  res.json(listNotifications.all());
});

const listCoinCharges = db.prepare(`
  SELECT cc.id, cc.amount_krw, cc.coins, cc.status, cc.provider, cc.admin_note, cc.created_at, cc.processed_at,
         u.name AS user_name, u.email AS user_email
  FROM coin_charges cc JOIN users u ON u.id = cc.user_id
  ORDER BY cc.created_at DESC
`);
const getCoinCharge = db.prepare('SELECT * FROM coin_charges WHERE id = ?');
const markChargeStatus = db.prepare(`
  UPDATE coin_charges SET status = ?, admin_note = ?, processed_at = datetime('now') WHERE id = ?
`);

router.get('/coin-charges', (req, res) => {
  res.json(listCoinCharges.all());
});

router.post('/coin-charges/:id/approve', (req, res) => {
  const charge = getCoinCharge.get(Number(req.params.id));
  if (!charge) return res.status(404).json({ error: '충전 요청을 찾을 수 없어요' });
  if (charge.status !== 'pending') return res.status(409).json({ error: '이미 처리된 요청이에요' });
  const note = String(req.body?.note || '').trim();

  creditCoins(charge.user_id, charge.coins, 'purchase', note || `관리자 수동 승인 (${charge.amount_krw.toLocaleString()}원 입금 확인)`);
  markChargeStatus.run('approved', note || null, charge.id);

  const user = getUserById.get(charge.user_id);
  notifyBySms(
    charge.user_id,
    user?.phone,
    `[포레스트클럽] ${charge.coins.toLocaleString()}코인이 충전됐어요.`,
    { kind: 'coin_charge_approved', variables: { coins: String(charge.coins) } }
  ).catch((err) => console.error('[notify] coin charge approve sms failed', err));

  res.json({ ok: true });
});

router.post('/coin-charges/:id/reject', (req, res) => {
  const charge = getCoinCharge.get(Number(req.params.id));
  if (!charge) return res.status(404).json({ error: '충전 요청을 찾을 수 없어요' });
  if (charge.status !== 'pending') return res.status(409).json({ error: '이미 처리된 요청이에요' });
  const reason = String(req.body?.reason || '').trim();

  markChargeStatus.run('rejected', reason || null, charge.id);

  const user = getUserById.get(charge.user_id);
  notifyBySms(
    charge.user_id,
    user?.phone,
    `[포레스트클럽] 코인 충전 요청이 반려됐어요.${reason ? ` (사유: ${reason})` : ''}`,
    { kind: 'coin_charge_rejected', variables: { reason } }
  ).catch((err) => console.error('[notify] coin charge reject sms failed', err));

  res.json({ ok: true });
});

router.get('/coin-ledger', (req, res) => {
  res.json(getRecentLedger());
});

module.exports = router;
