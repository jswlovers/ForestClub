// 초대제 프리미엄 멤버십 특성상 가입/지원/동행신청 남발(스팸, 봇 가입)을 막기 위한
// 가벼운 메모리 기반 요청 제한. 인스턴스 재시작 시 초기화되며, 소규모 서비스 기준으로 충분하다.
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now > entry.resetAt) hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: message || '요청이 너무 많아요. 잠시 후 다시 시도해주세요' });
    }
    next();
  };
}

module.exports = { rateLimit };
