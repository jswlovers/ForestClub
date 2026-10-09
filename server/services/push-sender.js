/**
 * 앱 푸시 발송 — Android는 FCM(HTTP v1), iOS는 APNs로 직접 보낸다. 외부 패키지 없이 Node 내장 모듈만 쓴다.
 * 원본: D:/github/service-apps/server/push-sender.js (각 서비스 서버에 같은 파일을 복사해 쓴다. 고치면 모두 같이 고칠 것)
 *
 * 환경변수 (없으면 해당 플랫폼은 mock — 콘솔 로그만 남기고 앱 동작에는 영향 없음)
 *   FCM_SERVICE_ACCOUNT_FILE  Firebase 서비스 계정 키(JSON) 경로
 *   APNS_KEY_FILE             Apple Push 인증 키(.p8) 경로
 *   APNS_KEY_ID, APNS_TEAM_ID 위 키의 Key ID, Apple 개발자 Team ID
 *
 * device = { platform: 'android' | 'ios' | 'ios-sandbox', token, topic(앱 번들 ID) }
 * message = { title, body, url }
 * 결과 = { ok, mocked?, invalid?(토큰이 더는 유효하지 않음 → 지워야 함), error? }
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http2 = require('node:http2');

const b64url = (data) => Buffer.from(data).toString('base64url');
const warned = new Set();
function mock(platform, device, message) {
  if (!warned.has(platform)) {
    warned.add(platform);
    console.log(`[push] ${platform} 푸시 키가 설정되지 않아 mock으로 처리합니다 (실제 발송 안 됨)`);
  }
  console.log(`[push:mock] ${platform} ${String(device.token).slice(0, 12)}… ${message.title}: ${message.body}`);
  return { ok: true, mocked: true };
}

// ---------------------------------------------------------------- FCM (Android)

let serviceAccount;
let fcmToken = { value: null, expiresAt: 0 };

function loadServiceAccount() {
  if (serviceAccount !== undefined) return serviceAccount;
  const file = process.env.FCM_SERVICE_ACCOUNT_FILE;
  serviceAccount = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return serviceAccount;
}

async function fcmAccessToken(sa) {
  if (fcmToken.value && Date.now() < fcmToken.expiresAt - 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`FCM 인증 실패: ${json.error_description || json.error || res.status}`);
  fcmToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return fcmToken.value;
}

async function sendFcm(device, message) {
  const sa = loadServiceAccount();
  if (!sa) return mock('android', device, message);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await fcmAccessToken(sa)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: device.token,
        notification: { title: message.title, body: message.body },
        data: message.url ? { url: message.url } : {},
        android: { priority: 'high', notification: { channel_id: 'alerts', sound: 'default' } },
      },
    }),
  });
  if (res.ok) return { ok: true };
  const json = await res.json().catch(() => ({}));
  const code = json.error?.details?.find((d) => d.errorCode)?.errorCode || json.error?.status;
  return { ok: false, invalid: res.status === 404 || code === 'UNREGISTERED', error: `${res.status} ${code || ''}`.trim() };
}

// ---------------------------------------------------------------- APNs (iOS)

let apnsJwt = { value: null, issuedAt: 0 };
const apnsSessions = {};

function apnsConfig() {
  const { APNS_KEY_FILE: file, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId } = process.env;
  if (!file || !keyId || !teamId || !fs.existsSync(file)) return null;
  return { key: fs.readFileSync(file, 'utf8'), keyId, teamId };
}

function apnsToken(cfg) {
  // Apple은 20~60분마다 새 토큰을 쓰라고 한다.
  if (apnsJwt.value && Date.now() - apnsJwt.issuedAt < 40 * 60_000) return apnsJwt.value;
  const unsigned = `${b64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }))}.${b64url(JSON.stringify({
    iss: cfg.teamId,
    iat: Math.floor(Date.now() / 1000),
  }))}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: cfg.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  apnsJwt = { value: `${unsigned}.${signature}`, issuedAt: Date.now() };
  return apnsJwt.value;
}

function apnsSession(host) {
  const existing = apnsSessions[host];
  if (existing && !existing.closed && !existing.destroyed) return existing;
  const session = http2.connect(`https://${host}`);
  session.on('error', () => session.destroy());
  session.on('goaway', () => session.close());
  session.unref();
  apnsSessions[host] = session;
  return session;
}

function sendApns(device, message) {
  const cfg = apnsConfig();
  if (!cfg) return Promise.resolve(mock('ios', device, message));
  // Xcode에서 바로 설치한 디버그 빌드는 sandbox, TestFlight/App Store 빌드는 운영 서버를 쓴다.
  const host = device.platform === 'ios-sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const payload = JSON.stringify({
    aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
    ...(message.url ? { url: message.url } : {}),
  });
  return new Promise((resolve) => {
    let req;
    try {
      req = apnsSession(host).request({
        ':method': 'POST',
        ':path': `/3/device/${device.token}`,
        authorization: `bearer ${apnsToken(cfg)}`,
        'apns-topic': device.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }
    let status = 0;
    let body = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (status === 200) return resolve({ ok: true });
      let reason = '';
      try { reason = JSON.parse(body).reason; } catch { /* 빈 응답 */ }
      resolve({ ok: false, invalid: status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered', error: `${status} ${reason}`.trim() });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(10_000, () => { req.close(); resolve({ ok: false, error: 'timeout' }); });
    req.end(payload);
  });
}

// ---------------------------------------------------------------- 공통

/** 앱이 심어둔 쿠키 값 "platform|topic|token"을 기기 정보로 바꾼다. 형식이 틀리면 null. */
function parseDeviceCookie(raw) {
  if (!raw || typeof raw !== 'string' || raw.length > 600) return null;
  const [platform, topic, token] = raw.split('|');
  if (!['android', 'ios', 'ios-sandbox'].includes(platform)) return null;
  if (!/^[A-Za-z0-9.-]{3,155}$/.test(topic || '') || !/^[A-Za-z0-9:_-]{20,400}$/.test(token || '')) return null;
  return { platform, topic, token };
}

async function sendPush(device, message) {
  try {
    return device.platform === 'android' ? await sendFcm(device, message) : await sendApns(device, message);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendPush, parseDeviceCookie };
