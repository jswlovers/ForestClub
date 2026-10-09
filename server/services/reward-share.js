const db = require('../db');
const { creditFreeCoins } = require('./coins');

// 여성 우수 회원 리워드(운영정책 "무료 코인" 지급 사유): 관리자가 우수 회원으로 지정한 여성 회원에게,
// 상대 회원이 그 회원과의 문자·보이스톡·페이스톡에 쓴 코인의 20%를 무료 코인으로 즉시 지급한다.
// 무료 코인이므로 환불·현금 교환·양도 대상이 아니다(이용약관 제14조, 제16조3항).
// 지급분은 매출에서 떼어 주는 게 아니라 무료 코인 지급과 같은 platform:marketing_cost로 처리된다.
const REWARD_SHARE_RATE = 0.2;

const findEligible = db.prepare(`
  SELECT id FROM users
  WHERE id = ? AND gender = 'female' AND reward_member_at IS NOT NULL AND status = 'approved'
    AND suspended_at IS NULL AND withdrawn_at IS NULL
`);

/**
 * spenderId가 earnerId와의 대화·통화에 spentCoins를 썼을 때, earnerId가 대상이면 20%를 무료 코인으로 지급한다.
 * 대상이 아니면 아무 일도 하지 않는다. 지급한 코인 수를 돌려준다.
 */
function grantRewardShare({ earnerId, spenderId, spentCoins, type, note }) {
  if (!earnerId || earnerId === spenderId) return 0;
  if (!findEligible.get(earnerId)) return 0;
  const amount = Math.floor(spentCoins * REWARD_SHARE_RATE);
  if (amount <= 0) return 0;
  creditFreeCoins(earnerId, amount, type, note);
  return amount;
}

module.exports = { grantRewardShare, REWARD_SHARE_RATE };
