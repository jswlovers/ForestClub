const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { notifyBySms } = require('../services/notify');

const router = express.Router();
router.use(requireAdmin);

const listUsers = db.prepare(`
  SELECT id, name, email, phone, role, created_at FROM users ORDER BY created_at DESC
`);

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

module.exports = router;
