const express = require('express');
const db = require('../db');
const { currentUser, requireAuth } = require('../auth');
const { notifyBySms } = require('../services/notify');
const { rateLimit } = require('../rate-limit');

const router = express.Router();

const insertApplication = db.prepare(`
  INSERT INTO applications
    (user_id, name, phone, email, age_group, region, job, golf_experience, interest, referrer, intro)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const myApplications = db.prepare(`
  SELECT id, name, phone, email, age_group, region, job, golf_experience, interest, referrer, intro,
         status, admin_note, created_at
  FROM applications WHERE user_id = ? ORDER BY created_at DESC
`);

const applyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: '지원서 제출이 너무 많아요. 잠시 후 다시 시도해주세요' });

router.post('/', applyLimiter, async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!name || !phone || !email) {
    return res.status(400).json({ error: '성함, 연락처, 이메일을 입력해주세요' });
  }

  const user = currentUser(req);
  const info = insertApplication.run(
    user ? user.id : null,
    name,
    phone,
    email,
    String(body.ageGroup || '').trim() || null,
    String(body.region || '').trim() || null,
    String(body.job || '').trim() || null,
    String(body.golfExperience || '').trim() || null,
    String(body.interest || '').trim() || null,
    String(body.referrer || '').trim() || null,
    String(body.intro || '').trim() || null
  );

  notifyBySms(
    user ? user.id : null,
    phone,
    `[포레스트클럽] ${name}님, 멤버십 지원서가 접수되었습니다. 영업일 기준 3일 이내 심사 결과를 안내드릴게요.`,
    { kind: 'application_received', variables: { name } }
  ).catch((err) => console.error('[notify] application received sms failed', err));

  res.status(201).json({ id: info.lastInsertRowid });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(myApplications.all(req.user.id));
});

module.exports = router;
