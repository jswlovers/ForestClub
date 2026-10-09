const express = require('express');
const { requireAuth, requireApproved } = require('../auth');
const db = require('../db');
const { debitCoins, getBalance, InsufficientCoinsError } = require('../services/coins');
const { grantRewardShare } = require('../services/reward-share');
const { rateLimit } = require('../rate-limit');
const { COST_PER_SEC, ENTRY_MIN_COINS, CONTINUE_MIN_COINS } = require('../call-pricing');

const router = express.Router();

// 통화방은 통화 요청 메시지(attachment_type='call')로 만들어지므로, 방 주소로 그 메시지를 찾아
// 요청자·수신자 중 "나 아닌 쪽"을 통화 상대로 본다(우수 회원 리워드 지급 대상 확인용).
const findCallParties = db.prepare(`
  SELECT sender_id, recipient_id FROM messages
  WHERE attachment_type = 'call' AND attachment_url = ? AND (sender_id = ? OR recipient_id = ?)
  ORDER BY id DESC LIMIT 1
`);
router.use(requireAuth);

const tickLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, message: '요청이 너무 많아요' });

router.get('/can-enter', (req, res) => {
  const coins = getBalance(req.user.id);
  res.json({ allowed: coins > ENTRY_MIN_COINS, coins, entryMin: ENTRY_MIN_COINS, continueMin: CONTINUE_MIN_COINS });
});

router.post('/tick', tickLimiter, requireApproved, (req, res) => {
  const callType = req.body.callType === 'video' ? 'video' : 'voice';
  const cost = COST_PER_SEC[callType];
  try {
    debitCoins(
      req.user.id,
      cost,
      callType === 'video' ? 'call_video_spend' : 'call_voice_spend',
      `${callType === 'video' ? '페이스톡' : '보이스톡'} 1초 이용`
    );
    const parties = req.body.roomUrl ? findCallParties.get(String(req.body.roomUrl), req.user.id, req.user.id) : null;
    if (parties) {
      // 리워드 지급이 실패해도 이미 과금된 통화는 끊지 않는다(지급 누락은 로그로 남겨 수동 보정).
      try {
        grantRewardShare({
          earnerId: parties.sender_id === req.user.id ? parties.recipient_id : parties.sender_id,
          spenderId: req.user.id,
          spentCoins: cost,
          type: callType === 'video' ? 'reward_share_video' : 'reward_share_voice',
          note: `우수 회원 리워드: ${callType === 'video' ? '페이스톡' : '보이스톡'} 1초 (상대: ${req.user.nickname})`,
        });
      } catch (err) {
        console.error('[reward] call reward share failed', err);
      }
    }
    const coins = getBalance(req.user.id);
    res.json({ coins, shouldEnd: coins <= CONTINUE_MIN_COINS, continueMin: CONTINUE_MIN_COINS });
  } catch (err) {
    if (err instanceof InsufficientCoinsError) {
      return res.status(402).json({ error: '코인이 부족해요', coins: getBalance(req.user.id) });
    }
    throw err;
  }
});

module.exports = router;
