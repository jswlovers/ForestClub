const express = require('express');
const db = require('../db');
const { currentUser, requireApproved } = require('../auth');
const { EVENTS, findEventByName } = require('../events-catalog');
const { rateLimit } = require('../rate-limit');
const { AttendanceError, confirmAttendance, cancelAttendance, listMyAttendances } = require('../services/attendance');

const router = express.Router();

const insertInterest = db.prepare(
  `INSERT INTO event_interests (user_id, event_name) VALUES (?, ?)`
);
const countInterests = db.prepare(
  `SELECT COUNT(*) AS c FROM event_interests WHERE event_name = ?`
);

const attendanceLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: '요청이 너무 많아요. 잠시 후 다시 시도해주세요' });

router.get('/', (req, res) => {
  const withCapacity = EVENTS.map((event) => {
    const taken = countInterests.get(event.name).c;
    return { ...event, remaining: Math.max(event.capacity - taken, 0) };
  });
  res.json(withCapacity);
});

router.post('/:eventName/interest', (req, res) => {
  const event = findEventByName(req.params.eventName);
  if (!event) return res.status(404).json({ error: '존재하지 않는 모임이에요' });
  const user = currentUser(req);
  insertInterest.run(user ? user.id : null, event.name);
  res.status(201).json({ ok: true });
});

// 모임 참석 확정(문서1 제12조의2) — 코인 보류가 시작된다. 화면에 정확한 보류 수량·해제 비율·
// 비용 직접결제 안내가 사전 표시돼야 한다는 요건은 프론트(index.html 이벤트 카드)에서 지킨다.
router.get('/attendances/me', requireApproved, (req, res) => {
  res.json(listMyAttendances.all(req.user.id));
});

router.post('/:eventName/confirm-attendance', attendanceLimiter, requireApproved, (req, res) => {
  const eventDate = String(req.body?.eventDate || '').trim();
  try {
    const attendance = confirmAttendance(req.user.id, req.params.eventName, eventDate);
    res.status(201).json(attendance);
  } catch (err) {
    if (err instanceof AttendanceError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

router.post('/attendances/:id/cancel', requireApproved, (req, res) => {
  try {
    const attendance = cancelAttendance(req.user.id, Number(req.params.id));
    res.json(attendance);
  } catch (err) {
    if (err instanceof AttendanceError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

module.exports = router;
