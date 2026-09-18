const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { notifyBySms } = require('../services/notify');
const { creditCoins, getRecentLedger } = require('../services/coins');
const { rateLimit } = require('../rate-limit');

const router = express.Router();
router.use(requireAdmin);

const listUsers = db.prepare(`
  SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at, u.suspended_at, u.suspended_reason,
    u.verified_identity_at, u.verified_employment_at, u.verified_golf_at,
    COALESCE((
      SELECT SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END)
      FROM coin_ledger WHERE account = 'user:' || u.id
    ), 0) AS coins,
    COALESCE((
      SELECT COUNT(*) FROM support_tickets WHERE category = 'report' AND target_user_id = u.id
    ), 0) AS report_count
  FROM users u ORDER BY u.created_at DESC
`);
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const suspendUserStmt = db.prepare(`UPDATE users SET suspended_at = datetime('now'), suspended_reason = ? WHERE id = ?`);
const unsuspendUserStmt = db.prepare(`UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?`);

const setVerified = {
  identity: db.prepare(`UPDATE users SET verified_identity_at = datetime('now') WHERE id = ?`),
  employment: db.prepare(`UPDATE users SET verified_employment_at = datetime('now') WHERE id = ?`),
  golf: db.prepare(`UPDATE users SET verified_golf_at = datetime('now') WHERE id = ?`),
};
const clearVerified = {
  identity: db.prepare(`UPDATE users SET verified_identity_at = NULL WHERE id = ?`),
  employment: db.prepare(`UPDATE users SET verified_employment_at = NULL WHERE id = ?`),
  golf: db.prepare(`UPDATE users SET verified_golf_at = NULL WHERE id = ?`),
};

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

router.post('/users/:id/suspend', (req, res) => {
  const target = getUserById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: '회원을 찾을 수 없어요' });
  if (target.role === 'admin') return res.status(400).json({ error: '관리자 계정은 정지할 수 없어요' });
  const reason = String(req.body?.reason || '').trim();
  suspendUserStmt.run(reason || null, target.id);
  res.json({ ok: true });
});

router.post('/users/:id/unsuspend', (req, res) => {
  const target = getUserById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: '회원을 찾을 수 없어요' });
  unsuspendUserStmt.run(target.id);
  res.json({ ok: true });
});

// 인증 배지 부여/해제. 심사(재직/골프 구력 등)를 확인한 관리자가 수동으로 표시한다.
router.post('/users/:id/verify', (req, res) => {
  const target = getUserById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: '회원을 찾을 수 없어요' });
  const type = String(req.body?.type || '');
  if (!setVerified[type]) return res.status(400).json({ error: '인증 종류를 확인해주세요' });
  if (req.body?.verified === false) {
    clearVerified[type].run(target.id);
  } else {
    setVerified[type].run(target.id);
  }
  res.json({ ok: true });
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

const listNotifyTargets = db.prepare(`
  SELECT id, phone FROM users WHERE role != 'admin' AND phone IS NOT NULL AND phone != ''
`);
const notifyLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: '발송 요청이 너무 많아요. 잠시 후 다시 시도해주세요' });

// 결제 확인, 공지 등 회원에게 임의로 보내는 안내 메시지. 전체(연락처 등록자) 또는 특정 회원에게 발송한다.
router.post('/notify', notifyLimiter, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: '보낼 메시지를 입력해주세요' });
  if (message.length > 1000) return res.status(400).json({ error: '메시지가 너무 길어요 (최대 1000자)' });

  let targets;
  if (req.body?.target === 'all') {
    targets = listNotifyTargets.all();
  } else {
    const target = getUserById.get(Number(req.body?.userId));
    if (!target || target.role === 'admin') return res.status(404).json({ error: '회원을 찾을 수 없어요' });
    if (!target.phone) return res.status(400).json({ error: '이 회원은 등록된 연락처가 없어요' });
    targets = [target];
  }
  if (!targets.length) return res.status(400).json({ error: '연락처가 등록된 회원이 없어요' });

  const results = await Promise.allSettled(
    targets.map((u) => notifyBySms(u.id, u.phone, message, { kind: 'admin_notice', variables: { message } }))
  );
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value?.ok).length;

  res.json({ ok: true, total: results.length, sent, failed: results.length - sent });
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

const listTickets = db.prepare(`
  SELECT t.id, t.category, t.subject, t.body, t.status, t.admin_note, t.refund_coins, t.created_at, t.processed_at,
         u.id AS user_id, u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
         tgt.id AS target_id, tgt.name AS target_name, tgt.suspended_at AS target_suspended_at,
         cc.amount_krw AS charge_amount_krw, cc.coins AS charge_coins
  FROM support_tickets t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN users tgt ON tgt.id = t.target_user_id
  LEFT JOIN coin_charges cc ON cc.id = t.coin_charge_id
  ORDER BY t.created_at DESC
`);
const getTicket = db.prepare('SELECT * FROM support_tickets WHERE id = ?');
const updateTicketStatus = db.prepare(`
  UPDATE support_tickets SET status = ?, admin_note = ?, processed_at = datetime('now') WHERE id = ?
`);
const setTicketRefund = db.prepare(`
  UPDATE support_tickets SET status = 'resolved', admin_note = ?, refund_coins = ?, processed_at = datetime('now') WHERE id = ?
`);

const TICKET_STATUS_TEXT = {
  in_progress: '처리 중으로 변경됐어요',
  resolved: '처리 완료됐어요',
  rejected: '반려됐어요',
};

router.get('/tickets', (req, res) => {
  res.json(listTickets.all());
});

router.post('/tickets/:id/status', (req, res) => {
  const ticket = getTicket.get(Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: '문의를 찾을 수 없어요' });
  const status = String(req.body?.status || '');
  if (!TICKET_STATUS_TEXT[status]) return res.status(400).json({ error: '처리 상태를 확인해주세요' });
  const note = String(req.body?.note || '').trim();
  updateTicketStatus.run(status, note || null, ticket.id);

  const user = getUserById.get(ticket.user_id);
  notifyBySms(
    ticket.user_id,
    user?.phone,
    `[포레스트클럽] 문의하신 "${ticket.subject}" 건이 ${TICKET_STATUS_TEXT[status]}.${note ? ` (${note})` : ''}`,
    { kind: 'ticket_status', variables: { subject: ticket.subject, status } }
  ).catch((err) => console.error('[notify] ticket status sms failed', err));

  res.json({ ok: true });
});

router.post('/tickets/:id/refund', (req, res) => {
  const ticket = getTicket.get(Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: '문의를 찾을 수 없어요' });
  if (ticket.category !== 'refund') return res.status(400).json({ error: '환불 요청 건이 아니에요' });
  if (ticket.status === 'resolved') return res.status(409).json({ error: '이미 처리된 요청이에요' });
  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: '환불할 코인 수를 확인해주세요' });
  const note = String(req.body?.note || '').trim();

  creditCoins(ticket.user_id, amount, 'refund', note || `환불 처리 (문의 #${ticket.id})`);
  setTicketRefund.run(note || null, amount, ticket.id);

  const user = getUserById.get(ticket.user_id);
  notifyBySms(
    ticket.user_id,
    user?.phone,
    `[포레스트클럽] ${amount.toLocaleString()}코인이 환불 처리됐어요.`,
    { kind: 'ticket_refund', variables: { amount: String(amount) } }
  ).catch((err) => console.error('[notify] ticket refund sms failed', err));

  res.json({ ok: true });
});

const listIdentityVerifications = db.prepare(`
  SELECT iv.id, iv.document_url, iv.status, iv.admin_note, iv.created_at, iv.processed_at,
         u.id AS user_id, u.name AS user_name, u.email AS user_email, u.phone AS user_phone
  FROM identity_verifications iv
  JOIN users u ON u.id = iv.user_id
  ORDER BY iv.created_at DESC
`);
const getIdentityVerification = db.prepare('SELECT * FROM identity_verifications WHERE id = ?');
const updateIdentityStatus = db.prepare(`
  UPDATE identity_verifications SET status = ?, admin_note = ?, processed_at = datetime('now') WHERE id = ?
`);

router.get('/identity-verifications', (req, res) => {
  res.json(listIdentityVerifications.all());
});

router.post('/identity-verifications/:id/approve', (req, res) => {
  const record = getIdentityVerification.get(Number(req.params.id));
  if (!record) return res.status(404).json({ error: '신청을 찾을 수 없어요' });
  if (record.status !== 'pending') return res.status(409).json({ error: '이미 처리된 신청이에요' });
  const note = String(req.body?.note || '').trim();

  updateIdentityStatus.run('approved', note || null, record.id);
  setVerified.identity.run(record.user_id);

  const user = getUserById.get(record.user_id);
  notifyBySms(
    record.user_id,
    user?.phone,
    `[포레스트클럽] 본인 인증이 승인됐어요. 프로필에 인증 배지가 표시돼요.`,
    { kind: 'identity_approved', variables: {} }
  ).catch((err) => console.error('[notify] identity approve sms failed', err));

  res.json({ ok: true });
});

router.post('/identity-verifications/:id/reject', (req, res) => {
  const record = getIdentityVerification.get(Number(req.params.id));
  if (!record) return res.status(404).json({ error: '신청을 찾을 수 없어요' });
  if (record.status !== 'pending') return res.status(409).json({ error: '이미 처리된 신청이에요' });
  const reason = String(req.body?.reason || '').trim();

  updateIdentityStatus.run('rejected', reason || null, record.id);

  const user = getUserById.get(record.user_id);
  notifyBySms(
    record.user_id,
    user?.phone,
    `[포레스트클럽] 본인 인증 신청이 반려됐어요.${reason ? ` (사유: ${reason})` : ''} 다시 신청해주세요.`,
    { kind: 'identity_rejected', variables: { reason } }
  ).catch((err) => console.error('[notify] identity reject sms failed', err));

  res.json({ ok: true });
});

module.exports = router;
