/**
 * 토스페이먼츠 결제 승인 어댑터.
 * TOSS_SECRET_KEY가 없으면 "설정 안 됨"으로 응답해, 프론트는 관리자 수동승인 흐름으로
 * 안내한다. 위젯(클라이언트 키)과 실제 체크아웃 UI는 별도로 연동이 필요하다 —
 * 여기서는 결제 승인 API 호출만 준비해둔다.
 * https://docs.tosspayments.com/reference#결제-승인
 */
async function confirmTossPayment({ paymentKey, orderId, amount }) {
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    return { ok: false, configured: false, response: null };
  }

  const auth = Buffer.from(`${secretKey}:`).toString('base64');
  try {
    const res = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[payment toss] 결제 승인 실패', res.status, data);
      return { ok: false, configured: true, response: data };
    }
    return { ok: true, configured: true, response: data };
  } catch (err) {
    console.error('[payment toss] 요청 오류', err);
    return { ok: false, configured: true, response: { error: String(err) } };
  }
}

module.exports = { confirmTossPayment };
