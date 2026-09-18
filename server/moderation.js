const db = require('./db');
const { notifyBySms } = require('./services/notify');

// 같은 회원에 대한 '회원 신고' 티켓이 누적되면 자동으로 경고 → 정지 처리한다.
// 관리자 개입 없이도 최소한의 안전장치가 즉시 작동하도록 하기 위함.
const WARN_THRESHOLD = 3;
const SUSPEND_THRESHOLD = 5;

const countReportsStmt = db.prepare(`
  SELECT COUNT(*) AS c FROM support_tickets WHERE category = 'report' AND target_user_id = ?
`);
const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const suspendUserStmt = db.prepare(`
  UPDATE users SET suspended_at = datetime('now'), suspended_reason = ? WHERE id = ?
`);

function countReportsFor(userId) {
  return countReportsStmt.get(userId).c;
}

// 신고 티켓이 새로 생겨 카운트가 오른 직후 호출한다. 임계치에 '처음' 도달한 순간에만
// 알림을 보내 같은 안내가 반복 발송되지 않게 한다(카운트는 계속 증가만 하므로 등호 비교로 충분).
function applyAutoModeration(targetUserId) {
  const count = countReportsFor(targetUserId);
  const target = getUserById.get(targetUserId);
  if (!target) return;

  if (count === SUSPEND_THRESHOLD && !target.suspended_at) {
    suspendUserStmt.run(`신고 누적(${count}건) 자동 정지`, target.id);
    if (target.phone) {
      notifyBySms(
        target.id,
        target.phone,
        `[포레스트클럽] 신고가 누적되어 이용이 자동으로 정지됐어요. 문의사항은 고객센터로 남겨주세요.`,
        { kind: 'auto_suspend', variables: { count: String(count) } }
      ).catch((err) => console.error('[notify] auto suspend sms failed', err));
    }
  } else if (count === WARN_THRESHOLD) {
    if (target.phone) {
      notifyBySms(
        target.id,
        target.phone,
        `[포레스트클럽] 다른 회원의 신고가 누적되고 있어요. 반복되면 이용이 제한될 수 있으니 유의해주세요.`,
        { kind: 'auto_warning', variables: { count: String(count) } }
      ).catch((err) => console.error('[notify] auto warning sms failed', err));
    }
  }
}

module.exports = { WARN_THRESHOLD, SUSPEND_THRESHOLD, countReportsFor, applyAutoModeration };
