const express = require('express');
const db = require('../db');
const { currentUser } = require('../auth');
const { EVENTS, findEventByName } = require('../events-catalog');

const router = express.Router();

const insertInterest = db.prepare(
  `INSERT INTO event_interests (user_id, event_name) VALUES (?, ?)`
);

router.get('/', (req, res) => {
  res.json(EVENTS);
});

router.post('/:eventName/interest', (req, res) => {
  const event = findEventByName(req.params.eventName);
  if (!event) return res.status(404).json({ error: '존재하지 않는 모임이에요' });
  const user = currentUser(req);
  insertInterest.run(user ? user.id : null, event.name);
  res.status(201).json({ ok: true });
});

module.exports = router;
