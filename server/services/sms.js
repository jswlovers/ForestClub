const crypto = require('node:crypto');

/**
 * 문자 발송 어댑터.
 * SMS_PROVIDER=mock (기본값): 실제 네트워크 호출 없이 콘솔에만 출력.
 * SMS_PROVIDER=solapi: SOLAPI_API_KEY/SOLAPI_API_SECRET/SOLAPI_SENDER가 모두 있어야 실제 발송.
 *   키가 비어 있으면 자동으로 mock으로 대체되어 앱 동작에는 영향이 없다.
 */
async function sendSms(phone, message) {
  const provider = process.env.SMS_PROVIDER || 'mock';

  if (provider === 'solapi') {
    const apiKey = process.env.SOLAPI_API_KEY;
    const apiSecret = process.env.SOLAPI_API_SECRET;
    const sender = process.env.SOLAPI_SENDER;
    if (apiKey && apiSecret && sender) {
      return sendViaSolapi({ apiKey, apiSecret, sender, phone, message });
    }
    console.warn('[SMS] SMS_PROVIDER=solapi 이지만 SOLAPI_* 키가 설정되지 않아 mock으로 대체합니다.');
  }

  console.log(`[SMS mock] -> ${phone}: ${message}`);
  return { ok: true, mocked: true, response: null };
}

async function sendViaSolapi({ apiKey, apiSecret, sender, phone, message }) {
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
        message: { to: phone, from: sender, text: message },
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[SMS solapi] 발송 실패', res.status, data);
      return { ok: false, mocked: false, response: data };
    }
    return { ok: true, mocked: false, response: data };
  } catch (err) {
    console.error('[SMS solapi] 요청 오류', err);
    return { ok: false, mocked: false, response: { error: String(err) } };
  }
}

module.exports = { sendSms };
