const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { rateLimit } = require('../rate-limit');
const campaign = require('../services/kakao-campaign');

const router = express.Router();
router.use(requireAdmin);

const sendLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, message: '발송 요청이 너무 많아요. 잠시 후 다시 시도해주세요' });

const listCampaigns = db.prepare(`
  SELECT c.id, c.type, c.audience, c.message, c.total, c.sent, c.mocked, c.failed, c.skipped_no_consent, c.created_at,
         tgt.name AS target_name, adm.name AS admin_name
  FROM kakao_campaigns c
  JOIN users adm ON adm.id = c.admin_id
  LEFT JOIN users tgt ON tgt.id = c.target_user_id
  ORDER BY c.id DESC LIMIT 100
`);
const consentCounts = db.prepare(`
  SELECT COUNT(*) AS total, COALESCE(SUM(marketing_opt_in_at IS NOT NULL), 0) AS consented
  FROM users WHERE role != 'admin' AND phone IS NOT NULL AND phone != '' AND suspended_at IS NULL
`);

router.get('/status', (req, res) => {
  const counts = consentCounts.get();
  res.json({
    ...campaign.getStatus(),
    reachable: counts.total,
    consented: counts.consented,
    maxMessageLength: campaign.MAX_MESSAGE_LENGTH,
    adPrefix: campaign.AD_PREFIX,
    adSuffix: campaign.AD_SUFFIX,
  });
});

// 발송 전에 몇 명에게 가는지, 동의하지 않아 빠지는 인원은 몇 명인지 보여준다.
router.get('/preview', (req, res) => {
  const { type, audience, userId } = req.query;
  if (!campaign.TYPES.has(type) || !campaign.AUDIENCES.has(audience)) {
    return res.status(400).json({ error: '메시지 종류와 대상을 확인해주세요' });
  }
  const { recipients, skippedNoConsent } = campaign.resolveRecipients(type, audience, userId);
  res.json({
    count: recipients.length,
    skippedNoConsent,
    sampleNames: recipients.slice(0, 5).map((u) => u.name),
  });
});

router.post('/send', sendLimiter, async (req, res) => {
  const { type, audience, userId, message } = req.body || {};
  const result = await campaign.sendCampaign({ adminId: req.user.id, type, audience, userId, message });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, ...result });
});

router.get('/campaigns', (req, res) => {
  res.json(listCampaigns.all());
});

module.exports = router;
