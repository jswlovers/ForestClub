const db = require('../db');
const { sendSms } = require('./sms');
const { sendAlimtalk } = require('./kakao');

const insertNotification = db.prepare(`
  INSERT INTO notifications (user_id, phone, channel, message, status, provider_response)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// 알림 종류 → 카카오 알림톡 템플릿 ID를 지정하는 환경변수 이름.
// 채널 담당자가 카카오 비즈니스 채널에서 아래 종류의 템플릿을 만들고 심사 승인을 받은 뒤,
// 승인된 templateId를 .env에 채우면 해당 종류의 알림부터 자동으로 알림톡으로 전환된다.
const TEMPLATE_ENV = {
  welcome: 'KAKAO_TEMPLATE_WELCOME',
  application_received: 'KAKAO_TEMPLATE_APPLICATION_RECEIVED',
  application_approved: 'KAKAO_TEMPLATE_APPROVED',
  application_rejected: 'KAKAO_TEMPLATE_REJECTED',
  companion_request: 'KAKAO_TEMPLATE_COMPANION_REQUEST',
  companion_response: 'KAKAO_TEMPLATE_COMPANION_RESPONSE',
  password_reset: 'KAKAO_TEMPLATE_PASSWORD_RESET',
  coin_charge_approved: 'KAKAO_TEMPLATE_COIN_CHARGE_APPROVED',
  coin_charge_rejected: 'KAKAO_TEMPLATE_COIN_CHARGE_REJECTED',
  new_message: 'KAKAO_TEMPLATE_NEW_MESSAGE',
  ticket_status: 'KAKAO_TEMPLATE_TICKET_STATUS',
  ticket_refund: 'KAKAO_TEMPLATE_TICKET_REFUND',
  auto_warning: 'KAKAO_TEMPLATE_AUTO_WARNING',
  auto_suspend: 'KAKAO_TEMPLATE_AUTO_SUSPEND',
  identity_approved: 'KAKAO_TEMPLATE_IDENTITY_APPROVED',
  identity_rejected: 'KAKAO_TEMPLATE_IDENTITY_REJECTED',
  // 관리자가 회원 전체/개별에게 임의로 보내는 안내 메시지(결제 안내, 공지 등).
  // 알림톡 템플릿은 자유 문구를 그대로 담을 수 있도록 변수 하나(#{message})로 구성해 등록하세요.
  admin_notice: 'KAKAO_TEMPLATE_ADMIN_NOTICE',
};

/**
 * 회원에게 알림을 보내고 발송 결과를 notifications 테이블에 기록한다.
 * kind에 해당하는 카카오 알림톡 템플릿이 설정돼 있으면 알림톡으로, 아니면 SMS로 보낸다.
 * (둘 다 키/템플릿이 없으면 자동으로 mock 처리되어 앱 동작에는 영향이 없다.)
 *
 * @param {number|null} userId
 * @param {string} phone
 * @param {string} text - 실제 발송 문구(SMS 발송문 또는 알림톡 실패 시 대체 문구)
 * @param {{kind?: string, variables?: Record<string,string>}} [options]
 */
async function notifyBySms(userId, phone, text, options = {}) {
  if (!phone) return null;
  const { kind, variables = {} } = options;

  const templateEnvKey = kind && TEMPLATE_ENV[kind];
  const templateId = templateEnvKey && process.env[templateEnvKey];
  const kakaoConfigured = process.env.KAKAO_PF_ID && templateId;

  let result;
  let channel;
  if (kakaoConfigured) {
    result = await sendAlimtalk(phone, templateId, variables, text);
    channel = 'kakao';
  } else {
    result = await sendSms(phone, text);
    channel = 'sms';
  }

  const status = result.ok ? (result.mocked ? 'mock' : 'sent') : 'failed';
  insertNotification.run(userId || null, phone, channel, text, status, JSON.stringify(result.response || null));
  return result;
}

module.exports = { notifyBySms };
