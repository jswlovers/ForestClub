const fs = require('node:fs');
const crypto = require('node:crypto');

// Porkbun이 무료로 발급해주는 Let's Encrypt 인증서를 API로 받아 로컬 인증서 파일을 갱신한다.
// Porkbun 쪽 인증서는 Porkbun이 알아서 갱신하지만, 이 서버가 읽는 파일은 누군가 새로 받아 넣어야 한다.
// 필요 조건: Porkbun API 키 발급 + 해당 도메인의 "API Access" 켜기 + 도메인 DNS가 Porkbun 네임서버.

const PORKBUN_SSL_URL = 'https://api.porkbun.com/api/json/v3/ssl/retrieve/';
// 만료까지 이 일수 이하로 남았을 때부터 새 인증서를 받아본다. Porkbun이 아직 갱신 전이면
// 같은 인증서가 내려오므로 파일은 건드리지 않고 다음 확인 때 다시 시도한다.
const RENEW_BEFORE_DAYS = Number(process.env.CERT_RENEW_BEFORE_DAYS || 30);

function daysLeft(certPem) {
  const cert = new crypto.X509Certificate(certPem);
  return (new Date(cert.validTo).getTime() - Date.now()) / 86400000;
}

// PORKBUN_DOMAIN이 없으면 현재 인증서의 CN에서 도메인을 뽑는다(*.example.com → example.com).
function domainFromCert(certPem) {
  const cn = /CN=([^\n,]+)/.exec(new crypto.X509Certificate(certPem).subject);
  return cn ? cn[1].trim().replace(/^\*\./, '') : null;
}

async function fetchPorkbunBundle(domain) {
  const res = await fetch(PORKBUN_SSL_URL + encodeURIComponent(domain), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: process.env.PORKBUN_API_KEY,
      secretapikey: process.env.PORKBUN_SECRET_API_KEY,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status !== 'SUCCESS') {
    throw new Error(`Porkbun 인증서 조회 실패 (${res.status}): ${body.message || '응답을 해석할 수 없음'}`);
  }
  return { cert: body.certificatechain, key: body.privatekey };
}

// 받은 인증서가 온전한지(파싱되는지, 키와 짝이 맞는지) 확인한 뒤에만 파일을 바꾼다.
// 잘못된 파일을 쓰면 서버가 다음 기동 때 HTTPS를 못 띄우기 때문이다.
function validateBundle({ cert, key }) {
  const x509 = new crypto.X509Certificate(cert);
  if (!x509.checkPrivateKey(crypto.createPrivateKey(key))) {
    throw new Error('받은 인증서와 개인키가 서로 맞지 않아요');
  }
  if (new Date(x509.validTo).getTime() <= Date.now()) {
    throw new Error('받은 인증서가 이미 만료됐어요');
  }
}

// 기존 파일은 .bak으로 남기고, 임시 파일에 쓴 뒤 rename으로 바꿔 중간에 끊겨도 반쪽 파일이 남지 않게 한다.
function writeAtomic(filePath, content) {
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak`);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function isConfigured() {
  return !!(process.env.PORKBUN_API_KEY && process.env.PORKBUN_SECRET_API_KEY &&
    process.env.HTTPS_CERT_PATH && process.env.HTTPS_KEY_PATH);
}

/**
 * 만료가 가까우면(또는 force) Porkbun에서 인증서를 받아 HTTPS_CERT_PATH/HTTPS_KEY_PATH를 교체한다.
 * @returns {{renewed: boolean, reason: string, validTo: string}}
 */
async function renewIfNeeded({ force = false } = {}) {
  const certPath = process.env.HTTPS_CERT_PATH;
  const keyPath = process.env.HTTPS_KEY_PATH;
  const currentPem = fs.readFileSync(certPath, 'utf8');
  const current = new crypto.X509Certificate(currentPem);
  const left = daysLeft(currentPem);

  if (!force && left > RENEW_BEFORE_DAYS) {
    return { renewed: false, reason: `만료까지 ${Math.floor(left)}일 남아 갱신하지 않음`, validTo: current.validTo };
  }

  const domain = process.env.PORKBUN_DOMAIN || domainFromCert(currentPem);
  if (!domain) throw new Error('도메인을 알 수 없어요. .env에 PORKBUN_DOMAIN을 지정해주세요');

  const bundle = await fetchPorkbunBundle(domain);
  validateBundle(bundle);
  const fetched = new crypto.X509Certificate(bundle.cert);

  if (new Date(fetched.validTo) <= new Date(current.validTo)) {
    return {
      renewed: false,
      reason: `Porkbun 인증서가 아직 갱신 전이에요 (만료 ${fetched.validTo}). 다음 확인 때 다시 시도합니다`,
      validTo: current.validTo,
    };
  }

  writeAtomic(keyPath, bundle.key);
  writeAtomic(certPath, bundle.cert);
  return { renewed: true, reason: `${domain} 인증서 갱신 완료`, validTo: fetched.validTo };
}

module.exports = { renewIfNeeded, isConfigured, daysLeft };
