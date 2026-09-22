const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { hashPassword, verifyPassword, createSession, destroySession, currentUser, requireAuth } = require('../auth');
const { notifyBySms } = require('../services/notify');
const { rateLimit } = require('../rate-limit');
const legalVersions = require('../legal-versions');

const router = express.Router();

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const findById = db.prepare('SELECT * FROM users WHERE id = ?');
const findByNickname = db.prepare('SELECT id FROM users WHERE nickname = ?');
const insertUser = db.prepare(
  `INSERT INTO users (name, email, phone, password_hash, role, nickname, birth_date, gender, marital_status, status)
   VALUES (?, ?, ?, ?, 'member', ?, ?, ?, ?, 'pending')`
);
const insertConsent = db.prepare(`
  INSERT INTO consent_logs (user_id, consent_type, agreed, document_version, ip_address, user_agent, channel)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const updateProfile = db.prepare(`
  UPDATE users SET phone = ?, age_group = ?, region = ?, job = ?, golf_experience = ?, interest = ?, intro = ?
  WHERE id = ?
`);
// 동의 일시는 처음 동의한 시각을 유지한다(이미 동의한 상태에서 다시 저장해도 덮어쓰지 않음).
const setMarketingOptIn = db.prepare(`UPDATE users SET marketing_opt_in_at = COALESCE(marketing_opt_in_at, datetime('now')) WHERE id = ?`);
const clearMarketingOptIn = db.prepare('UPDATE users SET marketing_opt_in_at = NULL WHERE id = ?');
const updatePasswordHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const updatePhoto = db.prepare('UPDATE users SET photo_url = ? WHERE id = ?');
// 탈퇴: 로그인 자체를 막기 위해 비밀번호 해시를 절대 검증되지 않는 값으로 바꾸고,
// 다른 회원에게 공개되던 항목만 비운다. 이름/생년월일/연락처는 1년 재가입 제한 확인 용도로 남긴다(제5조6항).
const withdrawUser = db.prepare(`
  UPDATE users SET
    password_hash = 'withdrawn:' || lower(hex(randomblob(16))),
    email = 'withdrawn-' || id || '@forestclub.invalid',
    nickname = NULL,
    photo_url = NULL,
    intro = NULL,
    job = NULL,
    region = NULL,
    interest = NULL,
    golf_experience = NULL,
    withdrawn_at = datetime('now')
  WHERE id = ?
`);

const PHOTO_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'profiles');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
const PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (PHOTO_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('사진 파일(jpg/png/gif/webp)만 올릴 수 있어요'));
  },
});

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

// 닉네임은 다른 회원에게 노출되는 유일한 식별자다. 운영자 사칭을 막기 위해 관리자/운영진을 연상시키는
// 단어는 금지한다(운영정책 "닉네임 규칙" 표).
const NICKNAME_RE = /^[가-힣a-zA-Z0-9]{2,12}$/;
const BANNED_NICKNAME_RE = /(관리자|어드민|admin|운영자|운영진|포레스트클럽|forestclub|forest club)/i;
const GENDERS = ['male', 'female'];
// 'married'는 절대 저장하지 않는다 — 선택 즉시 가입을 막고, 서버도 이 값이 오면 그대로 거부한다(이용약관 제5조5항).
const STORABLE_MARITAL_STATUSES = ['single', 'divorced_widowed'];

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// 생년월일(YYYY-MM-DD)로 만 나이를 계산한다. 2023년 6월 이후 법정 기준인 '만 나이'로 통일.
function calcAge(birthDateStr) {
  const birth = new Date(`${birthDateStr}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

const signupLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 8, message: '가입 시도가 너무 많아요. 잠시 후 다시 시도해주세요' });
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: '로그인 시도가 너무 많아요. 잠시 후 다시 시도해주세요' });
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: '인증코드 요청이 너무 많아요. 잠시 후 다시 시도해주세요' });

// 닉네임 실시간 중복확인. 형식이 잘못돼도 400을 던지지 않고 available:false로 응답해
// 입력 중인 사용자에게 타이핑마다 에러 토스트가 뜨지 않게 한다.
router.get('/nickname-available', (req, res) => {
  const nickname = String(req.query.nickname || '').trim();
  if (!NICKNAME_RE.test(nickname) || BANNED_NICKNAME_RE.test(nickname)) {
    return res.json({ available: false, reason: '한글/영문/숫자 2~12자로 입력해주세요' });
  }
  res.json({ available: !findByNickname.get(nickname) });
});

router.post('/signup', signupLimiter, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  const nickname = String(req.body.nickname || '').trim();
  const birthDate = String(req.body.birthDate || '').trim();
  const gender = String(req.body.gender || '');
  const maritalStatus = String(req.body.maritalStatus || '');
  const ageAgreed = req.body.ageAgreed === true;
  const termsAgreed = req.body.termsAgreed === true;
  const privacyAgreed = req.body.privacyAgreed === true;
  const marketingAgreed = req.body.marketingAgreed === true;

  if (!name || !email || password.length < 8) {
    return res.status(400).json({ error: '이름, 이메일, 8자 이상 비밀번호를 확인해주세요' });
  }
  if (phone && !PHONE_RE.test(phone)) {
    return res.status(400).json({ error: '연락처 형식을 확인해주세요 (예: 010-1234-5678)' });
  }
  if (!NICKNAME_RE.test(nickname) || BANNED_NICKNAME_RE.test(nickname)) {
    return res.status(400).json({ error: '닉네임은 한글/영문/숫자 2~12자로 입력해주세요' });
  }
  // 나이 확인이 먼저다 — 만 19세 미만이면 그 자리에서 막고, 입력받은 생년월일은 어디에도 저장하지 않는다.
  const age = calcAge(birthDate);
  if (age === null) {
    return res.status(400).json({ error: '생년월일을 확인해주세요' });
  }
  if (age < 19) {
    return res.status(400).json({ error: '만 19세 이상만 가입할 수 있어요' });
  }
  if (!GENDERS.includes(gender)) {
    return res.status(400).json({ error: '성별을 선택해주세요' });
  }
  if (maritalStatus === 'married') {
    return res.status(400).json({ error: '포레스트클럽은 법률상 배우자가 없는 분만 가입하실 수 있어요' });
  }
  if (!STORABLE_MARITAL_STATUSES.includes(maritalStatus)) {
    return res.status(400).json({ error: '혼인 여부를 선택해주세요' });
  }
  if (!ageAgreed || !termsAgreed || !privacyAgreed) {
    return res.status(400).json({ error: '필수 동의 항목(만 19세 이상, 이용약관, 개인정보 수집·이용)을 모두 체크해주세요' });
  }
  if (findByEmail.get(email)) {
    return res.status(409).json({ error: '이미 가입된 이메일이에요' });
  }
  if (findByNickname.get(nickname)) {
    return res.status(409).json({ error: '이미 사용 중인 닉네임이에요' });
  }

  const ip = String(req.ip || '').slice(0, 100);
  const userAgent = String(req.get('user-agent') || '').slice(0, 300);

  let userId;
  db.exec('BEGIN');
  try {
    const info = insertUser.run(name, email, phone || null, hashPassword(password), nickname, birthDate, gender, maritalStatus);
    userId = info.lastInsertRowid;
    insertConsent.run(userId, 'age19', 1, legalVersions.terms, ip, userAgent, 'signup');
    insertConsent.run(userId, 'terms', 1, legalVersions.terms, ip, userAgent, 'signup');
    insertConsent.run(userId, 'privacy', 1, legalVersions.privacy, ip, userAgent, 'signup');
    insertConsent.run(userId, 'marketing', marketingAgreed ? 1 : 0, null, ip, userAgent, 'signup');
    if (marketingAgreed) setMarketingOptIn.run(userId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  createSession(res, userId);

  if (phone) {
    notifyBySms(
      userId,
      phone,
      `[포레스트클럽] ${name}님, 회원가입 신청이 접수됐어요. 서류 심사와 인터뷰를 거쳐 결과를 안내드릴게요.`,
      { kind: 'welcome', variables: { name } }
    ).catch((err) => console.error('[notify] signup welcome sms failed', err));
  }

  res.status(201).json({ id: userId, name, email, nickname, role: 'member', status: 'pending' });
});

router.post('/login', loginLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = findByEmail.get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않아요' });
  }
  if (user.suspended_at) {
    return res.status(403).json({ error: `이용이 정지된 계정이에요.${user.suspended_reason ? ` (사유: ${user.suspended_reason})` : ''} 고객센터로 문의해주세요` });
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
  // 수신 동의는 값이 실제로 전달됐을 때만 바꾼다(다른 프로필 저장 요청이 동의 상태를 지우지 않도록).
  if (typeof body.marketingOptIn === 'boolean') {
    (body.marketingOptIn ? setMarketingOptIn : clearMarketingOptIn).run(req.user.id);
    // 동의/철회 이력은 덮어쓰지 않고 매번 새 행으로 쌓는다 — "언제부터 언제까지 동의 상태였는지"의 증거.
    insertConsent.run(
      req.user.id, 'marketing', body.marketingOptIn ? 1 : 0, null,
      String(req.ip || '').slice(0, 100), String(req.get('user-agent') || '').slice(0, 300), 'settings'
    );
  }
  res.json(currentUser(req));
});

// 회원 탈퇴. 즉시 반영되며, 가입만큼 쉬워야 한다는 원칙에 따라 확인 절차 외의 장애물을 두지 않는다.
router.post('/withdraw', requireAuth, (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(400).json({ error: '관리자 계정은 이 화면에서 탈퇴할 수 없어요' });
  }
  withdrawUser.run(req.user.id);
  destroySession(req, res);
  res.status(204).end();
});

// 프로필 사진. 동행 신청 후보 목록 등 다른 회원에게도 노출되므로 소유자 확인 없이
// 로그인한 회원이면 누구나 조회할 수 있게 한다(쪽지 첨부파일과 달리 비공개가 아님).
router.post('/photo', requireAuth, (req, res, next) => {
  uploadPhoto.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '사진을 업로드하지 못했어요' });
    next();
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: '사진 파일을 선택해주세요' });
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }[req.file.mimetype];
  const filename = `${req.user.id}-${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, filename), req.file.buffer);
  const photoUrl = `/api/auth/photo/${filename}`;
  updatePhoto.run(photoUrl, req.user.id);
  res.json({ photoUrl });
});

router.get('/photo/:filename', requireAuth, (req, res) => {
  const filePath = path.join(PHOTO_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
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
