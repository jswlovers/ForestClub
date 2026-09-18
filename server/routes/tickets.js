const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { rateLimit } = require('../rate-limit');
const { applyAutoModeration } = require('../moderation');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = new Set(['complaint', 'refund', 'report', 'other']);

const listTargetMembers = db.prepare(`
  SELECT id, name FROM users WHERE role != 'admin' AND id != ? ORDER BY name
`);
const getTargetMember = db.prepare(`SELECT id FROM users WHERE id = ? AND role != 'admin'`);
const getChargeForUser = db.prepare(`SELECT id FROM coin_charges WHERE id = ? AND user_id = ?`);

const insertTicket = db.prepare(`
  INSERT INTO support_tickets (user_id, category, subject, body, target_user_id, coin_charge_id)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const myTickets = db.prepare(`
  SELECT t.id, t.category, t.subject, t.body, t.status, t.admin_note, t.refund_coins, t.created_at, t.processed_at,
         tgt.name AS target_name
  FROM support_tickets t
  LEFT JOIN users tgt ON tgt.id = t.target_user_id
  WHERE t.user_id = ? ORDER BY t.created_at DESC
`);

const ticketLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, message: '문의 접수가 너무 많아요. 잠시 후 다시 시도해주세요' });

router.get('/target-members', (req, res) => {
  res.json(listTargetMembers.all(req.user.id));
});

router.post('/', ticketLimiter, (req, res) => {
  const category = String(req.body.category || '').trim();
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!CATEGORIES.has(category)) {
    return res.status(400).json({ error: '문의 유형을 확인해주세요' });
  }
  if (!subject || !body) {
    return res.status(400).json({ error: '제목과 내용을 입력해주세요' });
  }

  let targetUserId = null;
  if (category === 'report') {
    targetUserId = Number(req.body.targetUserId) || null;
    if (targetUserId === req.user.id || !targetUserId || !getTargetMember.get(targetUserId)) {
      return res.status(400).json({ error: '신고할 회원을 선택해주세요' });
    }
  }

  let coinChargeId = null;
  if (category === 'refund' && req.body.coinChargeId) {
    coinChargeId = Number(req.body.coinChargeId);
    if (!getChargeForUser.get(coinChargeId, req.user.id)) {
      return res.status(400).json({ error: '연결할 충전 내역을 확인해주세요' });
    }
  }

  const info = insertTicket.run(req.user.id, category, subject, body, targetUserId, coinChargeId);
  if (category === 'report') applyAutoModeration(targetUserId);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.get('/me', (req, res) => {
  res.json(myTickets.all(req.user.id));
});

module.exports = router;
