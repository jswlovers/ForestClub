// 보이스톡/페이스톡 초당 과금 단가와 진입/유지 최소 잔액.
// server/routes/calls.js, server/routes/messages.js, public/assets/app.js에서
// 함께 참조하므로(프론트는 이 값을 직접 복사해서 쓰므로 바뀌면 그쪽도 맞춰야 한다) 여기 한 곳만 바꾸면 된다.
const COST_PER_SEC = { voice: 10, video: 100 };
const ENTRY_MIN_COINS = 3000; // 이 이하면 통화를 시작/참여할 수 없음
const CONTINUE_MIN_COINS = 1500; // 통화 중 이 이하로 떨어지면 강제 종료

module.exports = { COST_PER_SEC, ENTRY_MIN_COINS, CONTINUE_MIN_COINS };
