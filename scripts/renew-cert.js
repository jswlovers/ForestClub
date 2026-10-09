// Porkbun에서 인증서를 받아 HTTPS_CERT_PATH/HTTPS_KEY_PATH를 교체하는 스크립트.
// Windows 작업 스케줄러(작업 이름: PorkbunCertRenew)가 매일 이 스크립트를 실행한다.
// 이 인증서 파일을 가리키는 모든 서비스(포레스트클럽, mentors, golfhall, golf-booking, SmallERP, 첫맘곁)는
// 1시간 안에 파일 변경을 감지해 재시작 없이 새 인증서를 적용한다.
// 사용법: npm run renew-cert            (만료 30일 이내일 때만 갱신)
//         npm run renew-cert -- --force (남은 기간과 관계없이 지금 받아보기)
const { renewIfNeeded, isConfigured } = require('../server/services/cert-renewal');

if (!isConfigured()) {
  console.error('.env에 HTTPS_CERT_PATH, HTTPS_KEY_PATH, PORKBUN_API_KEY, PORKBUN_SECRET_API_KEY를 모두 설정해주세요.');
  process.exit(1);
}

renewIfNeeded({ force: process.argv.includes('--force') })
  .then((result) => {
    console.log(`${result.reason} (인증서 만료: ${result.validTo})`);
  })
  .catch((err) => {
    console.error(`갱신 실패: ${err.message}`);
    process.exit(1);
  });
