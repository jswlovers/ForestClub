const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../auth');
const { rateLimit } = require('../rate-limit');

const router = express.Router();
router.use(requireAuth);

// 신분증 사진은 동행 신청 후보에게 노출되는 프로필 사진과 달리 완전 비공개 자료라,
// data/uploads/profiles(공개)와 분리된 별도 폴더에 저장하고 본인/관리자만 열람하게 한다.
const DOCUMENT_DIR = path.join(__dirname, '..', '..', 'data', 'uploads', 'identity');
fs.mkdirSync(DOCUMENT_DIR, { recursive: true });
const DOCUMENT_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (DOCUMENT_MIME[file.mimetype]) cb(null, true);
    else cb(new Error('사진 파일(jpg/png/webp)만 올릴 수 있어요'));
  },
});

const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
const insertVerification = db.prepare(`
  INSERT INTO identity_verifications (user_id, document_url) VALUES (?, ?)
`);
const myVerifications = db.prepare(`
  SELECT id, status, admin_note, created_at, processed_at
  FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC
`);
const hasPending = db.prepare(`
  SELECT id FROM identity_verifications WHERE user_id = ? AND status = 'pending'
`);
const findByDocumentUrl = db.prepare(`SELECT * FROM identity_verifications WHERE document_url = ?`);

const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: '신청이 너무 많아요. 잠시 후 다시 시도해주세요' });

router.get('/me', (req, res) => {
  res.json(myVerifications.all(req.user.id));
});

router.post('/', uploadLimiter, (req, res, next) => {
  uploadDocument.single('document')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '신분증 사진을 업로드하지 못했어요' });
    next();
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: '신분증 사진을 선택해주세요' });

  const user = getUser.get(req.user.id);
  if (user.verified_identity_at) {
    return res.status(409).json({ error: '이미 본인 인증이 완료된 회원이에요' });
  }
  if (hasPending.get(req.user.id)) {
    return res.status(409).json({ error: '이미 심사 중인 신청이 있어요. 결과를 기다려주세요' });
  }

  const ext = DOCUMENT_MIME[req.file.mimetype];
  const filename = `${req.user.id}-${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(DOCUMENT_DIR, filename), req.file.buffer);
  const documentUrl = `/api/identity/document/${filename}`;
  const info = insertVerification.run(req.user.id, documentUrl);
  res.status(201).json({ id: info.lastInsertRowid, status: 'pending' });
});

router.get('/document/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const record = findByDocumentUrl.get(`/api/identity/document/${filename}`);
  if (!record) return res.status(404).end();
  if (record.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).end();
  const filePath = path.join(DOCUMENT_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

module.exports = router;
