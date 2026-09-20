const db = require('../db');
const { sendAlimtalk, sendFriendtalk } = require('./kakao');

// 카카오톡 단체/개별 메시지 발송(관리자 → 회원).
//  - alimtalk: 정보성 안내(결제 확인, 일정 변경 등). 승인된 템플릿(KAKAO_TEMPLATE_ADMIN_NOTICE)의
//    변수 하나(#{message})에 문구를 넣어 보낸다. 수신 동의 없이도 보낼 수 있지만 홍보 내용은 넣으면 안 된다.
//  - friendtalk: 친구톡. 자유 문구지만 광고성으로 취급되므로 광고 수신 동의 회원에게만 보내고,
//    "(광고)" 표기와 무료수신거부 문구를 자동으로 붙이며, 야간(20:50~08:00 KST)에는 발송하지 않는다.
// 카카오 키/템플릿이 없으면 실제 발송 없이 mock으로 기록만 한다(문자로 대신 보내지 않는다).

const TYPES = new Set(['alimtalk', 'friendtalk']);
const AUDIENCES = new Set(['all', 'user', 'interest_golf', 'interest_travel', 'approved', 'verified']);
const MAX_MESSAGE_LENGTH = 900; // 친구톡 본문 1,000자 제한에서 광고 표기/수신거부 문구 몫을 남김
const MAX_RECIPIENTS = 1000;
const BATCH_SIZE = 10;

const AD_PREFIX = '(광고)[포레스트클럽] ';
const AD_SUFFIX = '\n\n무료수신거부: 채널 차단';

const AUDIENCE_WHERE = {
  all: '1 = 1',
  user: 'u.id = @userId',
  interest_golf: `u.interest IN ('골프', '둘 다')`,
  interest_travel: `u.interest IN ('여행', '둘 다')`,
  approved: `EXISTS (SELECT 1 FROM applications a WHERE a.user_id = u.id AND a.status = 'approved')`,
  verified: 'u.verified_identity_at IS NOT NULL',
};

const insertCampaign = db.prepare(`
  INSERT INTO kakao_campaigns (admin_id, type, audience, target_user_id, message, total, skipped_no_consent)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const finishCampaign = db.prepare(`UPDATE kakao_campaigns SET sent = ?, mocked = ?, failed = ? WHERE id = ?`);
const insertNotification = db.prepare(`
  INSERT INTO notifications (user_id, phone, channel, message, status, provider_response, campaign_id)
  VALUES (?, ?, 'kakao', ?, ?, ?, ?)
`);

function getStatus() {
  const solapi = !!(process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && process.env.SOLAPI_SENDER);
  const channel = !!process.env.KAKAO_PF_ID;
  return {
    alimtalkLive: solapi && channel && !!process.env.KAKAO_TEMPLATE_ADMIN_NOTICE,
    friendtalkLive: solapi && channel,
    nightBlocked: isNightWindow(),
  };
}

// 카카오 친구톡 광고 발송 금지 시간대(20:50~다음날 08:00). 서버 시간대와 상관없이 한국 시간으로 판단한다.
function isNightWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour').value);
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  const minutes = hour * 60 + minute;
  return minutes >= 20 * 60 + 50 || minutes < 8 * 60;
}

function buildText(type, message) {
  return type === 'friendtalk' ? `${AD_PREFIX}${message}${AD_SUFFIX}` : message;
}

// 대상 회원을 고른다. 연락처가 없거나 정지된 회원, 관리자는 항상 제외한다.
// 친구톡은 광고 수신에 동의한 회원만 포함하고, 동의하지 않아 빠진 인원 수를 함께 알려준다.
function resolveRecipients(type, audience, userId) {
  const where = AUDIENCE_WHERE[audience];
  const rows = db.prepare(`
    SELECT u.id, u.name, u.phone, u.marketing_opt_in_at
    FROM users u
    WHERE u.role != 'admin' AND u.phone IS NOT NULL AND u.phone != '' AND u.suspended_at IS NULL
      AND ${where}
    ORDER BY u.id
  `).all(audience === 'user' ? { userId: Number(userId) } : {});

  if (type !== 'friendtalk') return { recipients: rows, skippedNoConsent: 0 };
  const recipients = rows.filter((u) => u.marketing_opt_in_at);
  return { recipients, skippedNoConsent: rows.length - recipients.length };
}

async function sendOne(type, user, text) {
  if (type === 'friendtalk') return sendFriendtalk(user.phone, text);
  const templateId = process.env.KAKAO_TEMPLATE_ADMIN_NOTICE;
  return sendAlimtalk(user.phone, templateId, { message: text }, text);
}

/**
 * @returns {Promise<{error?: string, campaignId?: number, total?: number, sent?: number, mocked?: number, failed?: number, skippedNoConsent?: number}>}
 */
async function sendCampaign({ adminId, type, audience, userId, message }) {
  if (!TYPES.has(type)) return { error: '메시지 종류를 확인해주세요' };
  if (!AUDIENCES.has(audience)) return { error: '받는 대상을 확인해주세요' };
  const trimmed = String(message || '').trim();
  if (!trimmed) return { error: '보낼 메시지를 입력해주세요' };
  if (trimmed.length > MAX_MESSAGE_LENGTH) return { error: `메시지가 너무 길어요 (최대 ${MAX_MESSAGE_LENGTH}자)` };
  if (type === 'friendtalk' && isNightWindow()) {
    return { error: '친구톡(광고)은 오후 8시 50분부터 다음 날 오전 8시까지 보낼 수 없어요. 아침에 다시 시도해주세요' };
  }

  const { recipients, skippedNoConsent } = resolveRecipients(type, audience, userId);
  if (!recipients.length) {
    return { error: type === 'friendtalk' && skippedNoConsent
      ? '광고 수신에 동의한 회원이 없어요'
      : '연락처가 등록된 대상 회원이 없어요' };
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return { error: `한 번에 ${MAX_RECIPIENTS}명까지만 보낼 수 있어요 (대상 ${recipients.length}명)` };
  }

  const text = buildText(type, trimmed);
  const info = insertCampaign.run(
    adminId, type, audience, audience === 'user' ? Number(userId) : null, trimmed, recipients.length, skippedNoConsent
  );
  const campaignId = Number(info.lastInsertRowid);

  let sent = 0;
  let mocked = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((user) =>
      sendOne(type, user, text).catch((err) => ({ ok: false, mocked: false, response: { error: String(err) } }))
    ));
    results.forEach((result, idx) => {
      const status = result.ok ? (result.mocked ? 'mock' : 'sent') : 'failed';
      if (status === 'sent') sent += 1;
      else if (status === 'mock') mocked += 1;
      else failed += 1;
      insertNotification.run(batch[idx].id, batch[idx].phone, text, status, JSON.stringify(result.response || null), campaignId);
    });
  }
  finishCampaign.run(sent, mocked, failed, campaignId);

  return { campaignId, total: recipients.length, sent, mocked, failed, skippedNoConsent };
}

module.exports = {
  TYPES, AUDIENCES, MAX_MESSAGE_LENGTH, AD_PREFIX, AD_SUFFIX,
  getStatus, isNightWindow, buildText, resolveRecipients, sendCampaign,
};
