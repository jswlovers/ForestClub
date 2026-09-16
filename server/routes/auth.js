const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const { hashPassword, verifyPassword, createSession, destroySession, currentUser, requireAuth } = require('../auth');
const { notifyBySms } = require('../services/notify');
const { rateLimit } = require('../rate-limit');

const router = express.Router();

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const findById = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUser = db.prepare(
  `INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'member')`
);
const updateProfile = db.prepare(`
  UPDATE users SET phone = ?, age_group = ?, region = ?, job = ?, golf_experience = ?, interest = ?, intro = ?
  WHERE id = ?
`);
const updatePasswordHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

const insertReset = db.prepare(
  `INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?, ?, ?)`
);
const findValidReset = db.prepare(`
  SELECT * FROM password_resets
  WHERE user_id = ? AND code_hash = ? AND used_at IS NULL AND expires_at > datetime('now')
  ORDER BY id DESC LIMIT 1
`);
const markResetUsed = db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`);

const PHONE_RE = /^0\d{1,2}-?\d{3,4}-?\d{4}$/;
const RESET_CODE_TTL_MS = 10 * 60 * 1000;

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

const signupLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 8, message: '가입 시도가 너무 많아요. 잠시 후 다시 시도해주세요' });
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: '로그인 시도가 너무 많아요. 잠시 후 다시 시도해주세요' });
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: '인증코드 요청이 너무 많아요. 잠시 후 다시 시도해주세요' });

router.post('/signup', signupLimiter, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');

  if (!name || !email || password.length < 8) {
    return res.status(400).json({ error: '이름, 이메일, 8자 이상 비밀번호를 확인해주세요' });
  }
  if (phone && !PHONE_RE.test(phone)) {
    return res.status(400).json({ error: '연락처 형식을 확인해주세요 (예: 010-1234-5678)' });
  }
  if (findByEmail.get(email)) {
    return res.status(409).json({ error: '이미 가입된 이메일이에요' });
  }

  const info = insertUser.run(name, email, phone || null, hashPassword(password));
  createSession(res, info.lastInsertRowid);

  if (phone) {
    notifyBySms(
      info.lastInsertRowid,
      phone,
      `[포레스트클럽] ${name}님, 회원가입을 환영합니다! 프리미엄 골프·여행 멤버십과 함께해주셔서 감사합니다.`,
      { kind: 'welcome', variables: { name } }
    ).catch((err) => console.error('[notify] signup welcome sms failed', err));
  }

  res.status(201).json({ id: info.lastInsertRowid, name, email, role: 'member' });
});

router.post('/login', loginLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = findByEmail.get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않아요' });
  }
  createSession(res, user.id);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.status(204).end();
});

router.get('/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다' });
  res.json(user);
});

router.patch('/profile', requireAuth, (req, res) => {
  const body = req.body || {};
  const phone = String(body.phone || '').trim();
  if (phone && !PHONE_RE.test(phone)) {
    return res.status(400).json({ error: '연락처 형식을 확인해주세요 (예: 010-1234-5678)' });
  }
  updateProfile.run(
    phone || null,
    String(body.ageGroup || '').trim() || null,
    String(body.region || '').trim() || null,
    String(body.job || '').trim() || null,
    String(body.golfExperience || '').trim() || null,
    String(body.interest || '').trim() || null,
    String(body.intro || '').trim() || null,
    req.user.id
  );
  res.json(currentUser(req));
});

router.post('/password', requireAuth, (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) {
    return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 해요' });
  }
  const user = findById.get(req.user.id);
  if (!verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: '현재 비밀번호가 올바르지 않아요' });
  }
  updatePasswordHash.run(hashPassword(newPassword), user.id);
  res.json({ ok: true });
});

// 비밀번호를 잊은 회원이 가입 시 등록한 연락처로 인증코드를 받아 재설정하는 흐름.
// 이메일 존재 여부를 알려주지 않기 위해, 가입 여부와 무관하게 항상 같은 응답을 준다.
router.post('/password-reset/request', resetLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = findByEmail.get(email);
  if (user && user.phone) {
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();
    insertReset.run(user.id, hashCode(code), expiresAt);
    notifyBySms(
      user.id,
      user.phone,
      `[포레스트클럽] 비밀번호 재설정 인증코드는 ${code} 입니다. 10분간 유효해요.`,
      { kind: 'password_reset', variables: { code } }
    ).catch((err) => console.error('[notify] password reset sms failed', err));
  }
  res.json({ ok: true, message: '가입된 연락처가 있다면 인증코드를 보내드렸어요' });
});

router.post('/password-reset/confirm', resetLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) {
    return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 해요' });
  }
  const user = findByEmail.get(email);
  const reset = user && findValidReset.get(user.id, hashCode(code));
  if (!reset) {
    return res.status(400).json({ error: '인증코드가 올바르지 않거나 만료됐어요' });
  }
  markResetUsed.run(reset.id);
  updatePasswordHash.run(hashPassword(newPassword), user.id);
  res.json({ ok: true });
});

module.exports = router;
