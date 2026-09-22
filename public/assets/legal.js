// 법적 문서 페이지(terms/privacy/operating-policy) 공용: 사업자 정보를 서버에서 받아와
// [id="legal-*"] 요소에 채운다. 값이 아직 없으면 서버가 "추후 공개 예정"으로 내려준다.
(async () => {
  try {
    const res = await fetch('/api/legal/business-info', { credentials: 'include' });
    const info = await res.json();
    const map = {
      'legal-biz-name': info.name,
      'legal-biz-ceo': info.ceo,
      'legal-biz-address': info.address,
      'legal-biz-regno': info.regNo,
      'legal-biz-ecommerce': info.ecommerceNo,
      'legal-biz-phone': info.phone,
      'legal-biz-email': info.email,
      'legal-terms-version': info.termsVersion,
      'legal-privacy-version': info.privacyVersion,
    };
    Object.entries(map).forEach(([id, value]) => {
      document.querySelectorAll(`[data-legal="${id}"]`).forEach((el) => {
        el.textContent = value;
        if (value === '추후 공개 예정') el.classList.add('pending');
      });
    });
  } catch {
    // 오프라인 등으로 값을 못 받아와도 페이지 자체(약관 조항)는 그대로 읽을 수 있어야 한다.
  }
})();
