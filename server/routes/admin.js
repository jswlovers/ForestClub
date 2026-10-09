const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { notifyBySms } = require('../services/notify');
const { creditCoins, creditFreeCoins, getRecentLedger } = require('../services/coins');
const { AttendanceError, resolveAttendance } = require('../services/attendance');
const { rateLimit } = require('../rate-limit');

const router = express.Router();
router.use(requireAdmin);

const listUsers = db.prepare(`
  SELECT u.id, u.name, u.nickname, u.email, u.phone, u.role, u.created_at, u.suspended_at, u.suspended_reason,
    u.gender, u.birth_date, u.marital_status, u.region, u.job, u.golf_experience, u.interest, u.referrer, u.intro,
    u.status, u.reward_member_at, u.rejected_at, u.rejected_reason, u.withdrawn_at,
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

// 회원가입 심사(서류 심사·인터뷰) 승인/거절. 승인 전까지는 requireApproved가 걸린 기능(쪽지/동행신청/
// 코인충전/통화/모임참석확정)을 쓸 수 없다 — 이용약관 제6조, 운영정책 제1장.
const approveUserStmt = db.prepare(`UPDATE users SET status = 'approved', rejected_at = NULL, rejected_reason = NULL WHERE id = ?`);
const rejectUserStmt = db.prepare(`UPDATE users SET status = 'rejected', rejected_at = datetime('now'), rejected_reason = ? WHERE id = ?`);
const getAppSetting = db.prepare(`SELECT value FROM app_settings WHERE key = ?`);

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

router.post('/users/:id/approve', (req, res) => {
  const target = getUserById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: '회원을 찾을 수 없어요' });
  if (target.status === 'approved') return res.status(409).json({ error: '이미 승인된 회원이에요' });

  approveUserStmt.run(target.id);

  // 웰컴 코인: 운영정책이 수량을 정할 때까지는 app_settings 기본값(0)이라 아무 일도 안 일어난다.
  const settingKey = target.gender === 'female' ? 'welcome_coins_female' : 'welcome_coins_male';
  const welcomeCoins = Number(getAppSetting.get(settingKey)?.value || 0);
  if (welcomeCoins > 0) {
    creditFreeCoins(target.id, welcomeCoins, 'welcome_bonus', '가입 승인 웰컴 코인');
  }

  notifyBySms(
    target.id,
    target.phone,
    `[포레스트클럽] ${target.name}님, 회원가입 심사를 통과하셨습니다! 지금부터 모든 기능을 이용하실 수 있어요.`,
    { kind: 'member_approved', variables: { name: target.name } }
  ).catch((err) => console.error('[notify] member approve sms failed', err));

  res.json({ ok: true });
});

router.post('/users/:id/reject', (req, res) => {
  const target = getUserById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: '회원을 찾을 수 없어요' });
  if (target.status === 'approved') return res.status(409).json({ error: '이미 승인된 회원이에요' });
  const reason = String(req.body?.reason || '').trim();

  rejectUserStmt.run(reason || null, target.id);

  notifyBySms(
    target.id,
    target.phone,
    `[포레스트클럽] ${target.name}님, 이번 심사 결과 아쉽게도 함께하지 못하게 되었습니다.${reason ? ` (사유: ${reason})` : ''} 거절일로부터 3개월 후 재신청하실 수 있어요.`,
    { kind: 'member_rejected', variables: { name: target.name, reason } }
  ).catch((err) => console.error('[notify] member reject sms failed', err));

  res.json({ ok: true });
});

// 여성 우수 회원 리워드 대상 지정/해제(services/reward-share.js). 여성 회원만 지정할 수 있다.
const setRewardMember = db.prepare(`UPDATE users SET reward_member_at = datetime('now') WHERE id = ?`);
const clearRewardMember = db.prepare('UPDATE users SET reward_member_at = NULL WHERE id = ?');
router.post('/users/:id/reward-member', (req, res) => {
  const target = getUserById.get(Number(req.params.id));
  if (!target || target.role === 'admin') return res.status(404).json({ error: '회원을 찾을 수 없어요' });
  if (req.body?.enabled === false) {
    clearRewardMember.run(target.id);
    return res.json({ ok: true, enabled: false });
  }
  if (target.gender !== 'female') return res.status(400).json({ error: '우수 회원 리워드는 여성 회원만 지정할 수 있어요' });
  if (target.status !== 'approved') return res.status(400).json({ error: '가입 승인된 회원만 지정할 수 있어요' });
  setRewardMember.run(target.id);
  res.json({ ok: true, enabled: true });
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

// 코인 발행 현황. "발행"은 회원 코인 계정에 들어간(대변) 코인 전부 — 유료 충전과 무료 지급(웰컴·출석·리워드 등).
// "사용·회수"는 회원 계정에서 나간(차변) 코인 — 문자·통화 사용, 모임 몰수, 환불 회수. 잔액 = 발행 - 사용·회수.
const coinIssuanceByMember = db.prepare(`
  SELECT u.id, u.name, u.nickname, u.email, u.gender, u.status, u.withdrawn_at, u.reward_member_at,
    COALESCE(SUM(CASE WHEN l.direction = 'credit' AND l.coin_type = 'paid' THEN l.amount END), 0) AS issued_paid,
    COALESCE(SUM(CASE WHEN l.direction = 'credit' AND l.coin_type = 'free' THEN l.amount END), 0) AS issued_free,
    COALESCE(SUM(CASE WHEN l.direction = 'debit' AND l.coin_type = 'paid' THEN l.amount END), 0) AS spent_paid,
    COALESCE(SUM(CASE WHEN l.direction = 'debit' AND l.coin_type = 'free' THEN l.amount END), 0) AS spent_free
  FROM users u
  LEFT JOIN coin_ledger l ON l.account = 'user:' || u.id
  WHERE u.role != 'admin'
  GROUP BY u.id
`);
router.get('/coin-issuance', (req, res) => {
  const members = coinIssuanceByMember.all().map((m) => {
    const issued = m.issued_paid + m.issued_free;
    const spent = m.spent_paid + m.spent_free;
    return {
      ...m, issued, spent, balance: issued - spent,
      balance_paid: m.issued_paid - m.spent_paid, balance_free: m.issued_free - m.spent_free,
    };
  });
  members.sort((a, b) => b.balance - a.balance || b.issued - a.issued || a.id - b.id);
  const sum = (key) => members.reduce((s, m) => s + m[key], 0);
  res.json({
    summary: {
      issued: sum('issued'), issuedPaid: sum('issued_paid'), issuedFree: sum('issued_free'),
      spent: sum('spent'), balance: sum('balance'), balancePaid: sum('balance_paid'), balanceFree: sum('balance_free'),
      holders: members.filter((m) => m.balance > 0).length, members: members.length,
    },
    members,
  });
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

// 모임 참석 확정 내역 — 실제 참석/무단불참을 관리자가 확인해 보류 코인을 정산한다(운영정책 제4장).
const listAttendances = db.prepare(`
  SELECT ea.*, u.nickname, u.name, u.phone
  FROM event_attendances ea JOIN users u ON u.id = ea.user_id
  ORDER BY ea.created_at DESC
`);

router.get('/event-attendances', (req, res) => {
  res.json(listAttendances.all());
});

router.post('/event-attendances/:id/attended', (req, res) => {
  try {
    const attendance = resolveAttendance(Number(req.params.id), { status: 'attended', releasedPct: 100 });
    res.json(attendance);
  } catch (err) {
    if (err instanceof AttendanceError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// 무단 불참 확정. penaltyKrw/penaltyNote는 골프장 등 제3자가 실제로 위약금을 부과했을 때만 채운다
// (실제 위약금이 없으면 코인 보류 몰수만 하고 별도 청구는 하지 않는다 — 운영정책 "위약금 청구 판단 기준").
router.post('/event-attendances/:id/no-show', (req, res) => {
  const penaltyKrw = req.body?.penaltyKrw != null ? Math.max(0, Math.floor(Number(req.body.penaltyKrw))) : null;
  const penaltyNote = String(req.body?.penaltyNote || '').trim() || null;
  try {
    const attendance = resolveAttendance(Number(req.params.id), { status: 'no_show', releasedPct: 0, penaltyKrw, penaltyNote });
    const user = getUserById.get(attendance.user_id);
    if (penaltyKrw) {
      notifyBySms(
        attendance.user_id,
        user?.phone,
        `[포레스트클럽] '${attendance.event_name}' 무단 불참으로 실제 위약금 ${penaltyKrw.toLocaleString()}원이 발생했어요. 고객센터로 문의해주세요.${penaltyNote ? ` (${penaltyNote})` : ''}`,
        { kind: 'event_no_show_penalty', variables: { eventName: attendance.event_name, penaltyKrw: String(penaltyKrw) } }
      ).catch((err) => console.error('[notify] no-show penalty sms failed', err));
    }
    res.json(attendance);
  } catch (err) {
    if (err instanceof AttendanceError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// 운영정책 문서가 [미정]으로 남긴 무료코인 수량 등을 관리자가 정하는 설정 화면.
const listSettings = db.prepare(`SELECT key, value, updated_at FROM app_settings ORDER BY key`);
const upsertSetting = db.prepare(`
  INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const ALLOWED_SETTING_KEYS = new Set(['welcome_coins_male', 'welcome_coins_female', 'daily_checkin_coins']);

router.get('/settings', (req, res) => {
  res.json(listSettings.all());
});

router.post('/settings/:key', (req, res) => {
  const key = req.params.key;
  if (!ALLOWED_SETTING_KEYS.has(key)) return res.status(400).json({ error: '알 수 없는 설정 항목이에요' });
  const value = Math.max(0, Math.floor(Number(req.body?.value)));
  if (!Number.isFinite(value)) return res.status(400).json({ error: '0 이상의 숫자를 입력해주세요' });
  upsertSetting.run(key, String(value));
  res.json({ ok: true });
});

// 성별별 유료 코인 구매 비율 점검 지표(운영정책 제2장) — 자동 조정은 하지 않고 참고용 수치만 제공한다.
router.get('/coin-policy/stats', (req, res) => {
  const rows = db.prepare(`
    SELECT u.gender,
           COALESCE(SUM(CASE WHEN cl.direction = 'credit' AND cl.coin_type = 'paid' THEN cl.amount ELSE 0 END), 0) AS paid_coins,
           COALESCE(SUM(CASE WHEN cl.direction = 'credit' AND cl.coin_type = 'free' THEN cl.amount ELSE 0 END), 0) AS free_coins
    FROM users u
    LEFT JOIN coin_ledger cl ON cl.account = 'user:' || u.id
    WHERE u.role != 'admin' AND u.gender IS NOT NULL
    GROUP BY u.gender
  `).all();
  res.json(rows);
});

module.exports = router;
