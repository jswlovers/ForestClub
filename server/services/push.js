/**
 * 앱 푸시 기기 관리 — 원본: D:/github/service-apps/server/push.js (골프홀·멘토스·포레스트클럽이 같은 파일을 쓴다)
 *
 * 앱(service-apps)은 푸시 토큰을 받으면 서비스 도메인에 `app_push` 쿠키("platform|번들ID|토큰")를 심는다.
 * 그 쿠키를 단 요청이 로그인 상태면 그 회원의 기기로 등록하고, 로그아웃 상태면 연결을 끊는다.
 * 그래서 웹 화면 코드를 고치지 않아도 되고, 같은 폰에서 다른 사람이 로그인해도 알림이 엉뚱한 사람에게 가지 않는다.
 */
const db = require('../db');
const { sendPush, parseDeviceCookie } = require('./push-sender');

db.exec(`
  CREATE TABLE IF NOT EXISTS push_devices (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    topic TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);
`);

const upsertDevice = db.prepare(`
  INSERT INTO push_devices (token, user_id, platform, topic) VALUES (?, ?, ?, ?)
  ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform,
    topic = excluded.topic, updated_at = datetime('now')
`);
const deleteDevice = db.prepare('DELETE FROM push_devices WHERE token = ?');
const devicesOf = db.prepare('SELECT token, platform, topic FROM push_devices WHERE user_id = ?');

// token → 마지막으로 반영한 user_id(0 = 로그아웃). 같은 상태면 매 요청마다 DB에 쓰지 않는다.
const bound = new Map();

function bind(raw, userId) {
  const device = parseDeviceCookie(raw);
  if (!device) return;
  const owner = userId || 0;
  if (bound.get(device.token) === owner) return;
  if (owner) upsertDevice.run(device.token, owner, device.platform, device.topic);
  else deleteDevice.run(device.token);
  if (bound.size > 10000) bound.clear();
  bound.set(device.token, owner);
}

/** cookie-parser 뒤, API 라우트 앞에 둔다. currentUser(req) → { id } | null */
function pushMiddleware(currentUser) {
  return (req, res, next) => {
    const raw = req.cookies?.app_push;
    if (raw) {
      try {
        bind(raw, currentUser(req)?.id);
      } catch (err) {
        console.error('[push] 기기 등록 오류', err.message);
      }
    }
    next();
  };
}

/** 회원의 모든 앱 기기로 푸시를 보낸다. 기다리지 않으며(fire-and-forget) 실패는 로그로만 남긴다. */
function pushToUser(userId, message) {
  if (!userId) return;
  for (const device of devicesOf.all(userId)) {
    sendPush(device, message).then((result) => {
      if (result.invalid) {
        deleteDevice.run(device.token); // 앱 삭제 등으로 더는 못 받는 기기
        bound.delete(device.token);
      } else if (!result.ok) {
        console.error('[push] 발송 실패', device.platform, result.error);
      }
    });
  }
}

/** 문자 문구 앞의 "[서비스명] "은 푸시 제목과 겹치므로 뗀다. */
function pushBody(text) {
  return String(text).replace(/^\[[^\]]+\]\s*/, '');
}

module.exports = { pushMiddleware, pushToUser, pushBody };
