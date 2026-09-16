const crypto = require('node:crypto');
const db = require('./db');

const SESSION_COOKIE = 'fc_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(check, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const insertSession = db.prepare(
  `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
);
const deleteSession = db.prepare(`DELETE FROM sessions WHERE token = ?`);
const getSession = db.prepare(
  `SELECT sessions.token, sessions.expires_at,
          users.id, users.name, users.email, users.phone, users.role,
          users.age_group, users.region, users.job, users.golf_experience, users.interest, users.intro
   FROM sessions JOIN users ON users.id = sessions.user_id
   WHERE sessions.token = ?`
);
const deleteExpiredSessions = db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`);

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  insertSession.run(token, userId, expiresAt);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
  });
}

function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) deleteSession.run(token);
  res.clearCookie(SESSION_COOKIE);
}

function currentUser(req) {
  deleteExpiredSessions.run();
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const row = getSession.get(token);
  if (!row) return null;
  return {
    id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role,
    ageGroup: row.age_group, region: row.region, job: row.job,
    golfExperience: row.golf_experience, interest: row.interest, intro: row.intro,
  };
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다' });
  if (user.role !== 'admin') return res.status(403).json({ error: '관리자만 접근할 수 있습니다' });
  req.user = user;
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  currentUser,
  requireAuth,
  requireAdmin,
};
