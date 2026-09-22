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
const deleteSessionsForUser = db.prepare(`DELETE FROM sessions WHERE user_id = ?`);
const getSession = db.prepare(
  `SELECT sessions.token, sessions.expires_at,
          users.id, users.name, users.email, users.phone, users.role, users.suspended_at,
          users.age_group, users.region, users.job, users.golf_experience, users.interest, users.intro,
          users.photo_url, users.verified_identity_at, users.verified_employment_at, users.verified_golf_at,
          users.marketing_opt_in_at,
          users.nickname, users.birth_date, users.gender, users.marital_status,
          users.status, users.rejected_at, users.rejected_reason
   FROM sessions JOIN users ON users.id = sessions.user_id
   WHERE sessions.token = ?`
);
const deleteExpiredSessions = db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`);

// 계정당 로그인은 한 곳에서만 유지되도록, 새 세션을 만들기 전에 기존 세션을 모두 지운다.
// (다른 기기/브라우저에서 로그인하면 이전 로그인은 다음 요청부터 자동으로 로그아웃 처리된다.)
function createSession(res, userId) {
  deleteSessionsForUser.run(userId);
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
  if (row.suspended_at) {
    deleteSession.run(token);
    return null;
  }
  return {
    id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role,
    nickname: row.nickname, birthDate: row.birth_date, gender: row.gender, maritalStatus: row.marital_status,
    status: row.status, rejectedAt: row.rejected_at, rejectedReason: row.rejected_reason,
    ageGroup: row.age_group, region: row.region, job: row.job,
    golfExperience: row.golf_experience, interest: row.interest, intro: row.intro,
    photoUrl: row.photo_url,
    marketingOptIn: !!row.marketing_opt_in_at,
    verified: {
      identity: !!row.verified_identity_at,
      employment: !!row.verified_employment_at,
      golf: !!row.verified_golf_at,
    },
  };
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다' });
  req.user = user;
  next();
}

// 쪽지 발송, 동행 신청, 코인 충전, 통화, 모임 참석 확정처럼 실제 서비스 이용(및 결제)에
// 해당하는 기능은 관리자 승인(서류 심사·인터뷰)을 마친 회원만 쓸 수 있게 막는다.
// 로그인 자체(requireAuth)는 심사 대기 중에도 허용해 신청 현황 확인/탈퇴는 가능하게 한다.
function requireApproved(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다' });
  if (user.role !== 'admin' && user.status !== 'approved') {
    return res.status(403).json({
      error: user.status === 'rejected'
        ? '가입 심사에서 승인되지 못했어요. 고객센터로 문의해주세요'
        : '가입 심사가 진행 중이에요. 승인 후 이용할 수 있어요',
    });
  }
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
  requireApproved,
  requireAdmin,
};
