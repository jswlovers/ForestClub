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

module.exports = { sendAlimtalk };
