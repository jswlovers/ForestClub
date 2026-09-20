const crypto = require('node:crypto');

/**
 * 카카오 알림톡(AlimTalk) 발송 어댑터 (Solapi 경유).
 * 알림톡은 사전에 카카오 비즈니스 채널(pfId)과, 심사 승인된 템플릿(templateId)이 있어야
 * 실제 발송이 가능하다. 채널/템플릿 준비가 안 된 동안에는 자동으로 mock으로 동작해
 * 앱 흐름에는 영향이 없다.
 */
async function sendAlimtalk(phone, templateId, variables, fallbackText) {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const sender = process.env.SOLAPI_SENDER;
  const pfId = process.env.KAKAO_PF_ID;

  if (!apiKey || !apiSecret || !sender || !pfId || !templateId) {
    console.log(`[Kakao mock] -> ${phone} (template ${templateId || 'N/A'}): ${fallbackText}`);
    return { ok: true, mocked: true, response: null };
  }

  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  const authorization = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

  try {
    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          to: phone,
          from: sender,
          text: fallbackText,
          kakaoOptions: {
            pfId,
            templateId,
            variables,
            disableSms: false, // 알림톡 실패 시 문자(SMS)로 자동 대체 발송
          },
        },
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[Kakao solapi] 발송 실패', res.status, data);
      return { ok: false, mocked: false, response: data };
    }
    return { ok: true, mocked: false, response: data };
  } catch (err) {
    console.error('[Kakao solapi] 요청 오류', err);
    return { ok: false, mocked: false, response: { error: String(err) } };
  }
}

/**
 * 카카오 친구톡(FriendTalk) 발송 어댑터 (Solapi 경유). 승인된 템플릿 없이 자유 문구를 보낼 수 있지만
 * 카카오 채널을 친구 추가한 사용자에게만 도달하고, 광고성 메시지(adFlag)로 취급된다.
 * 친구가 아닌 수신자는 카카오 쪽에서 실패 처리되며, 문자 대체 발송은 하지 않는다(광고 문자 이중 발송 방지).
 * 채널/키가 준비되지 않은 동안에는 mock으로 동작한다.
 */
async function sendFriendtalk(phone, text) {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const sender = process.env.SOLAPI_SENDER;
  const pfId = process.env.KAKAO_PF_ID;

  if (!apiKey || !apiSecret || !sender || !pfId) {
    console.log(`[Kakao friendtalk mock] -> ${phone}: ${text}`);
    return { ok: true, mocked: true, response: null };
  }

  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  const authorization = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;

  try {
    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          to: phone,
          from: sender,
          text,
          type: 'CTA',
          kakaoOptions: { pfId, adFlag: true, disableSms: true },
        },
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[Kakao friendtalk solapi] 발송 실패', res.status, data);
      return { ok: false, mocked: false, response: data };
    }
    return { ok: true, mocked: false, response: data };
  } catch (err) {
    console.error('[Kakao friendtalk solapi] 요청 오류', err);
    return { ok: false, mocked: false, response: { error: String(err) } };
  }
}

module.exports = { sendAlimtalk, sendFriendtalk };
