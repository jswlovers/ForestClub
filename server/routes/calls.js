const express = require('express');
const { requireAuth } = require('../auth');
const { debitCoins, getBalance, InsufficientCoinsError } = require('../services/coins');
const { rateLimit } = require('../rate-limit');
const { COST_PER_SEC, ENTRY_MIN_COINS, CONTINUE_MIN_COINS } = require('../call-pricing');

const router = express.Router();
router.use(requireAuth);

const tickLimiter = rateLimit({ windowMs: 60 * 1000, max: 90, message: '요청이 너무 많아요' });

router.get('/can-enter', (req, res) => {
  const coins = getBalance(req.user.id);
  res.json({ allowed: coins > ENTRY_MIN_COINS, coins, entryMin: ENTRY_MIN_COINS, continueMin: CONTINUE_MIN_COINS });
});

router.post('/tick', tickLimiter, (req, res) => {
  const callType = req.body.callType === 'video' ? 'video' : 'voice';
  const cost = COST_PER_SEC[callType];
  try {
    debitCoins(
      req.user.id,
      cost,
      callType === 'video' ? 'call_video_spend' : 'call_voice_spend',
      `${callType === 'video' ? '페이스톡' : '보이스톡'} 1초 이용`
    );
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
