const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { debitCoins, getBalance, InsufficientCoinsError } = require('../services/coins');
const { notifyBySms } = require('../services/notify');
const { rateLimit } = require('../rate-limit');

const router = express.Router();
router.use(requireAuth);

const MESSAGE_COST = 500; // 메시지 1건당 차감되는 코인
const MAX_INBOX_MESSAGES = 100; // 회원 1인당 받은 메시지함 최대 보관 개수

const listMembers = db.prepare(`
  SELECT id, name, age_group, region, interest, intro
  FROM users WHERE role != 'admin' AND id != ?
  ORDER BY created_at DESC
`);
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');

const insertMessage = db.prepare(`
  INSERT INTO messages (sender_id, recipient_id, body) VALUES (?, ?, ?)
`);
// 받은 메시지함이 최대 보관 개수를 넘으면 가장 오래된 것부터 정리한다.
const pruneInbox = db.prepare(`
  DELETE FROM messages WHERE recipient_id = ? AND id NOT IN (
    SELECT id FROM messages WHERE recipient_id = ? ORDER BY id DESC LIMIT ${MAX_INBOX_MESSAGES}
  )
`);

const inboxQuery = db.prepare(`
  SELECT m.id, m.body, m.created_at, u.id AS sender_id, u.name AS sender_name
  FROM messages m JOIN users u ON u.id = m.sender_id
  WHERE m.recipient_id = ? ORDER BY m.created_at DESC
`);
const sentQuery = db.prepare(`
  SELECT m.id, m.body, m.created_at, u.id AS recipient_id, u.name AS recipient_name
  FROM messages m JOIN users u ON u.id = m.recipient_id
  WHERE m.sender_id = ? ORDER BY m.created_at DESC
`);

const sendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, message: '메시지 발송이 너무 많아요. 잠시 후 다시 시도해주세요' });

router.get('/members', (req, res) => {
  res.json(listMembers.all(req.user.id));
});

router.post('/', sendLimiter, (req, res) => {
  const recipientId = Number(req.body.recipientUserId);
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: '메시지 내용을 입력해주세요' });
  if (!recipientId || recipientId === req.user.id) {
    return res.status(400).json({ error: '받는 회원을 확인해주세요' });
  }
  const recipient = getUserById.get(recipientId);
  if (!recipient || recipient.role === 'admin') {
    return res.status(404).json({ error: '받는 회원을 찾을 수 없어요' });
  }

  db.exec('BEGIN');
  try {
    debitCoins(req.user.id, MESSAGE_COST, 'message_spend', `메시지 발송 (받는 회원: ${recipient.name})`);
    const info = insertMessage.run(req.user.id, recipientId, body);
    pruneInbox.run(recipientId, recipientId);
    db.exec('COMMIT');

    if (recipient.phone) {
      notifyBySms(
        recipient.id,
        recipient.phone,
        `[포레스트클럽] ${req.user.name}님에게 새 메시지가 도착했어요. 앱에서 확인해주세요.`,
        { kind: 'new_message', variables: { senderName: req.user.name } }
      ).catch((err) => console.error('[notify] new message sms failed', err));
    }

    res.status(201).json({ id: info.lastInsertRowid, coins: getBalance(req.user.id) });
  } catch (err) {
    db.exec('ROLLBACK');
    if (err instanceof InsufficientCoinsError) {
      return res.status(402).json({ error: `코인이 부족해요 (메시지 1건당 ${MESSAGE_COST}코인 필요)` });
    }
    throw err;
  }
});

router.get('/inbox', (req, res) => {
  res.json(inboxQuery.all(req.user.id));
});

router.get('/sent', (req, res) => {
  res.json(sentQuery.all(req.user.id));
});

module.exports = router;
