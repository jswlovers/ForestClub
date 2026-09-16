const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { notifyBySms } = require('../services/notify');
const { findEventByName } = require('../events-catalog');
const { rateLimit } = require('../rate-limit');

const router = express.Router();
router.use(requireAuth);

const requestLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: '동행 신청이 너무 많아요. 잠시 후 다시 시도해주세요' });

// 다른 회원에게 특정 모임(라운딩/여행)의 동행을 신청할 수 있도록, 신청 후보로 보여줄 회원 목록.
// 프로필은 회원이 "내 프로필"에서 직접 입력/수정한 값을 그대로 노출한다.
const listMembers = db.prepare(`
  SELECT id, name, age_group, region, interest, intro
  FROM users
  WHERE role != 'admin' AND id != ?
  ORDER BY created_at DESC
`);

const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');

const insertRequest = db.prepare(`
  INSERT INTO companion_requests (requester_id, target_id, event_name, message)
  VALUES (?, ?, ?, ?)
`);

const incomingQuery = db.prepare(`
  SELECT cr.id, cr.event_name, cr.message, cr.status, cr.created_at,
         u.id AS requester_id, u.name AS requester_name
  FROM companion_requests cr
  JOIN users u ON u.id = cr.requester_id
  WHERE cr.target_id = ?
  ORDER BY cr.created_at DESC
`);

const outgoingQuery = db.prepare(`
  SELECT cr.id, cr.event_name, cr.message, cr.status, cr.created_at,
         u.id AS target_id, u.name AS target_name
  FROM companion_requests cr
  JOIN users u ON u.id = cr.target_id
  WHERE cr.requester_id = ?
  ORDER BY cr.created_at DESC
`);

const getRequestById = db.prepare('SELECT * FROM companion_requests WHERE id = ?');
const updateStatus = db.prepare(`UPDATE companion_requests SET status = ? WHERE id = ?`);

router.get('/members', (req, res) => {
  res.json(listMembers.all(req.user.id));
});

router.post('/', requestLimiter, async (req, res) => {
  const targetUserId = Number(req.body.targetUserId);
  const eventName = String(req.body.eventName || '').trim();
  const message = String(req.body.message || '').trim();

  const event = findEventByName(eventName);
  if (!event) return res.status(400).json({ error: '존재하지 않는 모임이에요' });
  if (!targetUserId || targetUserId === req.user.id) {
    return res.status(400).json({ error: '신청 대상 회원을 확인해주세요' });
  }
  const target = getUserById.get(targetUserId);
  if (!target || target.role === 'admin') {
    return res.status(404).json({ error: '대상 회원을 찾을 수 없어요' });
  }

  const info = insertRequest.run(req.user.id, targetUserId, event.name, message || null);

  if (target.phone) {
    const text = `[포레스트클럽] ${req.user.name}님이 '${event.name}' 모임에 동행을 신청했습니다.${message ? ` (메시지: ${message})` : ''} 앱에서 확인해주세요.`;
    notifyBySms(target.id, target.phone, text, {
      kind: 'companion_request',
      variables: { requesterName: req.user.name, eventName: event.name },
    }).catch((err) => console.error('[notify] companion request sms failed', err));
  }

  res.status(201).json({ id: info.lastInsertRowid });
});

router.get('/incoming', (req, res) => {
  res.json(incomingQuery.all(req.user.id));
});

router.get('/outgoing', (req, res) => {
  res.json(outgoingQuery.all(req.user.id));
});

function respondToRequest(status, successText) {
  return async (req, res) => {
    const request = getRequestById.get(Number(req.params.id));
    if (!request) return res.status(404).json({ error: '신청을 찾을 수 없어요' });
    if (request.target_id !== req.user.id) return res.status(403).json({ error: '권한이 없어요' });
    if (request.status !== 'pending') return res.status(409).json({ error: '이미 처리된 신청이에요' });

    updateStatus.run(status, request.id);

    const requester = getUserById.get(request.requester_id);
    if (requester?.phone) {
      const text = `[포레스트클럽] ${req.user.name}님이 '${request.event_name}' 동행 신청을 ${successText}.`;
      notifyBySms(requester.id, requester.phone, text, {
        kind: 'companion_response',
        variables: { responderName: req.user.name, eventName: request.event_name, result: successText },
      }).catch((err) => console.error('[notify] companion response sms failed', err));
    }

    res.json({ ok: true });
  };
}

router.post('/:id/accept', respondToRequest('accepted', '수락했습니다'));
router.post('/:id/decline', respondToRequest('declined', '정중히 거절했습니다'));

router.post('/:id/cancel', (req, res) => {
  const request = getRequestById.get(Number(req.params.id));
  if (!request) return res.status(404).json({ error: '신청을 찾을 수 없어요' });
  if (request.requester_id !== req.user.id) return res.status(403).json({ error: '권한이 없어요' });
  if (request.status !== 'pending') return res.status(409).json({ error: '이미 처리된 신청이에요' });
  updateStatus.run('cancelled', request.id);
  res.json({ ok: true });
});

module.exports = router;
