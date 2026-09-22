// 전자상거래법상 앱 내 상시 표시 의무사항(상호/사업자등록번호 등). 사업자 등록이 끝나기 전에는
// 값을 지어내지 않고 "추후 공개 예정"으로 내려준다 — 이용약관/개인정보처리방침 문서 자체도
// 이 값들을 [미정]으로 남겨뒀다.
const express = require('express');
const legalVersions = require('../legal-versions');

const router = express.Router();

const PENDING = '추후 공개 예정';

function envOrPending(key) {
  const value = String(process.env[key] || '').trim();
  return value || PENDING;
}

router.get('/business-info', (req, res) => {
  res.json({
    name: envOrPending('BUSINESS_NAME'),
    ceo: envOrPending('BUSINESS_CEO'),
    address: envOrPending('BUSINESS_ADDRESS'),
    regNo: envOrPending('BUSINESS_REG_NO'),
    ecommerceNo: envOrPending('BUSINESS_ECOMMERCE_NO'),
    phone: envOrPending('BUSINESS_PHONE'),
    email: envOrPending('BUSINESS_EMAIL'),
    termsVersion: legalVersions.terms,
    privacyVersion: legalVersions.privacy,
  });
});

module.exports = router;
