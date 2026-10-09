const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireApproved } = require('../auth');
const { debitCoins, getBalance, InsufficientCoinsError } = require('../services/coins');
const { grantRewardShare } = require('../services/reward-share');
const { notifyBySms } = require('../services/notify');
const { rateLimit } = require('../rate-limit');
const { createCallRoom } = require('../services/videocall');
const { ENTRY_MIN_COINS } = require('../call-pricing');

const router = express.Router();
router.use(requireAuth);

const MESSAGE_COST = 500; // 메시지 1건당 차감되는 코인 (텍스트/사진/파일/통화요청 모두 동일)
const MAX_INBOX_MESSAGES = 100; // 회원 1인당 받은 메시지함 최대 보관 개수
const MAX_BODY_LENGTH = 200; // 메시지(사진/파일 설명 포함) 최대 글자 수

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const FILE_MIME = new Set([
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'application/zip',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIME.has(file.mimetype) || FILE_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('지원하지 않는 파일 형식이에요'));
  },
});

// 실명은 절대 노출하지 않는다 — 다른 회원에게는 닉네임/나이/지역/직업만 보여준다.
const listMembers = db.prepare(`
  SELECT id, nickname,
         CAST((strftime('%Y%m%d', 'now') - strftime('%Y%m%d', birth_date)) / 10000 AS INTEGER) AS age,
         age_group, region, interest, intro, photo_url
  FROM users WHERE role != 'admin' AND id != ? AND withdrawn_at IS NULL AND status = 'approved'
  ORDER BY created_at DESC
`);
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');

// 메시지 단계적 개방(문서3 제5장의2): 음성통화는 상대와 텍스트를 한 번이라도 주고받았을 때만,
// 영상통화는 상대와 음성통화를 한 번이라도 했을 때만 허용한다.
const hasTextHistory = db.prepare(`
  SELECT 1 FROM messages
  WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
    AND attachment_type IS NULL
  LIMIT 1
`);
const hasVoiceCallHistory = db.prepare(`
  SELECT 1 FROM messages
  WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
    AND attachment_type = 'call' AND attachment_name = 'voice'
  LIMIT 1
`);

const insertMessage = db.prepare(`
  INSERT INTO messages (sender_id, recipient_id, body, attachment_type, attachment_url, attachment_name)
  VALUES (?, ?, ?, ?, ?, ?)
`);
// 받은 메시지함이 최대 보관 개수를 넘으면 가장 오래된 것부터 정리한다.
const pruneInbox = db.prepare(`
  DELETE FROM messages WHERE recipient_id = ? AND id NOT IN (
    SELECT id FROM messages WHERE recipient_id = ? ORDER BY id DESC LIMIT ${MAX_INBOX_MESSAGES}
  )
`);

// 대화 상대 목록: 나와 메시지를 주고받은 적 있는 회원들을 최근 대화 순으로.
const partnerIdsQuery = db.prepare(`
  SELECT DISTINCT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS other_id
  FROM messages WHERE sender_id = ? OR recipient_id = ?
`);
const lastMessageQuery = db.prepare(`
  SELECT body, attachment_type, created_at, sender_id FROM messages
  WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
  ORDER BY id DESC LIMIT 1
`);
const unreadFromQuery = db.prepare(`
  SELECT COUNT(*) AS c FROM messages WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL
`);
const totalUnreadQuery = db.prepare(`
  SELECT COUNT(*) AS c FROM messages WHERE recipient_id = ? AND read_at IS NULL
`);

const threadQuery = db.prepare(`
  SELECT id, sender_id, recipient_id, body, attachment_type, attachment_url, attachment_name, created_at, read_at
  FROM messages
  WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
  ORDER BY id ASC
`);
const markReadStmt = db.prepare(`
  UPDATE messages SET read_at = datetime('now') WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL
`);
const findMessageByAttachment = db.prepare(`SELECT * FROM messages WHERE attachment_url = ?`);

const sendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, message: '메시지 발송이 너무 많아요. 잠시 후 다시 시도해주세요' });

function previewFor(msg) {
  if (!msg) return '';
  if (msg.attachment_type === 'image') return '[사진]';
  if (msg.attachment_type === 'file') return '[파일]';
  if (msg.attachment_type === 'call') return '[통화 요청]';
  return msg.body;
}

router.get('/members', (req, res) => {
  res.json(listMembers.all(req.user.id));
});

router.get('/unread-count', (req, res) => {
  res.json({ count: totalUnreadQuery.get(req.user.id).c });
});

router.get('/conversations', (req, res) => {
  const partners = partnerIdsQuery.all(req.user.id, req.user.id, req.user.id);
  const list = partners.map(({ other_id: otherId }) => {
    const other = getUserById.get(otherId);
    const withdrawn = !other || other.withdrawn_at;
    const last = lastMessageQuery.get(req.user.id, otherId, otherId, req.user.id);
    const unread = unreadFromQuery.get(otherId, req.user.id).c;
    return {
      userId: otherId,
      nickname: withdrawn ? '(탈퇴한 회원)' : other.nickname,
      photoUrl: withdrawn ? null : other.photo_url,
      lastPreview: previewFor(last),
      lastAt: last ? last.created_at : null,
      lastMine: last ? last.sender_id === req.user.id : false,
      unread,
    };
  });
  list.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  res.json(list);
});

router.get('/conversations/:userId', (req, res) => {
  const otherId = Number(req.params.userId);
  const other = getUserById.get(otherId);
  if (!other || other.role === 'admin') return res.status(404).json({ error: '회원을 찾을 수 없어요' });
  const withdrawn = !!other.withdrawn_at;

  markReadStmt.run(req.user.id, otherId);
  const thread = threadQuery.all(req.user.id, otherId, otherId, req.user.id);
  res.json({
    partner: { id: other.id, nickname: withdrawn ? '(탈퇴한 회원)' : other.nickname, photoUrl: withdrawn ? null : other.photo_url },
    messages: thread,
  });
});

router.post('/', sendLimiter, requireApproved, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '파일을 업로드하지 못했어요' });
    next();
  });
}, async (req, res) => {
  const recipientId = Number(req.body.recipientUserId);
  const kind = req.body.kind === 'call' ? 'call' : (req.file ? 'attachment' : 'text');
  let body = String(req.body.body || '').trim();

  if (!recipientId || recipientId === req.user.id) {
    return res.status(400).json({ error: '받는 회원을 확인해주세요' });
  }
  const recipient = getUserById.get(recipientId);
  if (!recipient || recipient.role === 'admin' || recipient.withdrawn_at) {
    return res.status(404).json({ error: '받는 회원을 찾을 수 없어요' });
  }
  if (kind === 'text' && !body) {
    return res.status(400).json({ error: '메시지 내용을 입력해주세요' });
  }
  if (body.length > MAX_BODY_LENGTH) {
    return res.status(400).json({ error: `메시지는 ${MAX_BODY_LENGTH}자 이하로 입력해주세요` });
  }

  let attachmentType = null;
  let attachmentUrl = null;
  let attachmentName = null;

  if (kind === 'call') {
    if (getBalance(req.user.id) <= ENTRY_MIN_COINS) {
      return res.status(402).json({ error: `코인이 ${ENTRY_MIN_COINS.toLocaleString()}개 이하면 통화를 시작할 수 없어요. 충전 후 다시 시도해주세요`, coins: getBalance(req.user.id) });
    }
    const callType = req.body.callType === 'video' ? 'video' : 'voice';
    // 단계적 개방: 음성통화는 텍스트를 한 번이라도 주고받았을 때만, 영상통화는 음성통화 이력이
    // 있을 때만 허용한다(운영정책 제5장의2) — 즉흥적인 악용을 줄이기 위함.
    if (callType === 'voice' && !hasTextHistory.get(req.user.id, recipientId, recipientId, req.user.id)) {
      return res.status(403).json({ error: '메시지를 먼저 주고받은 상대와만 보이스톡을 할 수 있어요' });
    }
    if (callType === 'video' && !hasVoiceCallHistory.get(req.user.id, recipientId, recipientId, req.user.id)) {
      return res.status(403).json({ error: '보이스톡을 먼저 나눈 상대와만 페이스톡을 할 수 있어요' });
    }
    const result = await createCallRoom(callType);
    if (!result.configured) {
      return res.status(501).json({ error: '통화 기능이 아직 설정되지 않았어요. 관리자에게 문의해주세요' });
    }
    if (!result.ok) {
      return res.status(502).json({ error: '통화방을 만들지 못했어요. 잠시 후 다시 시도해주세요' });
    }
    attachmentType = 'call';
    attachmentUrl = result.url;
    attachmentName = callType;
    body = callType === 'video' ? '📹 페이스톡 통화를 요청했어요' : '📞 보이스톡 통화를 요청했어요';
  } else if (req.file) {
    if (!body) body = IMAGE_MIME.has(req.file.mimetype) ? '사진을 보냈어요' : '파일을 보냈어요';
  }

  db.exec('BEGIN');
  try {
    // 통화 요청은 초당 과금(콜 접속 후 /api/calls/tick)으로 별도 청구되므로 메시지 발송료는 받지 않는다.
    if (kind !== 'call') {
      debitCoins(req.user.id, MESSAGE_COST, 'message_spend', `메시지 발송 (받는 회원: ${recipient.name})`);
      grantRewardShare({
        earnerId: recipient.id, spenderId: req.user.id, spentCoins: MESSAGE_COST,
        type: 'reward_share_message', note: `우수 회원 리워드: 받은 메시지 (보낸 회원: ${req.user.nickname})`,
      });
    }

    if (req.file) {
      const ext = path.extname(req.file.originalname).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
      const filename = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, filename), req.file.buffer);
      attachmentType = IMAGE_MIME.has(req.file.mimetype) ? 'image' : 'file';
      attachmentUrl = `/api/messages/attachments/${filename}`;
      attachmentName = req.file.originalname;
    }

    const info = insertMessage.run(req.user.id, recipientId, body, attachmentType, attachmentUrl, attachmentName);
    pruneInbox.run(recipientId, recipientId);
    db.exec('COMMIT');

    if (recipient.phone) {
      notifyBySms(
        recipient.id,
        recipient.phone,
        `[포레스트클럽] ${req.user.nickname}님에게서 새 메시지가 도착했어요. 앱에서 확인해주세요.`,
        { kind: 'new_message', variables: { senderName: req.user.nickname } }
      ).catch((err) => console.error('[notify] new message sms failed', err));
    }

    res.status(201).json({ id: info.lastInsertRowid, coins: getBalance(req.user.id), attachmentUrl });
  } catch (err) {
    db.exec('ROLLBACK');
    if (err instanceof InsufficientCoinsError) {
      return res.status(402).json({ error: `코인이 부족해요 (메시지 1건당 ${MESSAGE_COST}코인 필요)` });
    }
    console.error('[messages] send failed', err);
    return res.status(500).json({ error: '메시지 전송에 실패했어요' });
  }
});

router.get('/attachments/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const url = `/api/messages/attachments/${filename}`;
  const msg = findMessageByAttachment.get(url);
  if (!msg) return res.status(404).end();
  if (msg.sender_id !== req.user.id && msg.recipient_id !== req.user.id) return res.status(403).end();
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

// 개인정보처리방침 제8조4항: 메시지 내용은 발송일로부터 1년이 지나면 파기한다.
// (받은 메시지함 100건 캡인 pruneInbox와는 별개로, 보낸 메시지함까지 포함해 전역으로 적용한다.)
const pruneOldStmt = db.prepare(`DELETE FROM messages WHERE created_at < datetime('now', '-365 days')`);
function pruneOldMessages() {
  const info = pruneOldStmt.run();
  if (info.changes > 0) console.log(`[messages] 1년 경과 메시지 ${info.changes}건 파기`);
  return info.changes;
}

module.exports = router;
module.exports.pruneOldMessages = pruneOldMessages;
