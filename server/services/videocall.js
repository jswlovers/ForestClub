/**
 * 보이스톡/페이스톡(음성·영상 통화) 어댑터 — Daily.co 사용.
 * WebRTC 자체를 직접 구현하는 대신, TURN/시그널링 인프라를 포함한 Daily.co의
 * "방(room) 생성 API"만 호출한다. DAILY_API_KEY가 없으면 미설정 상태로 응답해
 * 프론트가 '아직 통화 기능이 준비되지 않았어요' 안내로 대체하게 한다.
 * 가입: https://dashboard.daily.co (무료 티어로 월 일정 참가자-분까지 사용 가능)
 */
async function createCallRoom(type) {
  const apiKey = process.env.DAILY_API_KEY;
  if (!apiKey) {
    return { configured: false };
  }

  try {
    const res = await fetch('https://api.daily.co/v1/rooms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          start_video_off: type === 'voice',
          start_audio_off: false,
          enable_screenshare: true,
          exp: Math.round(Date.now() / 1000) + 60 * 60, // 1시간 뒤 자동 만료
        },
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.error('[videocall daily] 방 생성 실패', res.status, data);
      return { configured: true, ok: false, response: data };
    }
    return { configured: true, ok: true, url: data.url };
  } catch (err) {
    console.error('[videocall daily] 요청 오류', err);
    return { configured: true, ok: false, response: { error: String(err) } };
  }
}

module.exports = { createCallRoom };
