const express = require('express');
const db = require('../db');
const { currentUser } = require('../auth');
const { EVENTS, findEventByName } = require('../events-catalog');

const router = express.Router();

const insertInterest = db.prepare(
  `INSERT INTO event_interests (user_id, event_name) VALUES (?, ?)`
);
const countInterests = db.prepare(
  `SELECT COUNT(*) AS c FROM event_interests WHERE event_name = ?`
);

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

module.exports = router;
