const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'forest-club.sqlite'));

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    age_group TEXT,
    region TEXT,
    job TEXT,
    golf_experience TEXT,
    interest TEXT,
    intro TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    age_group TEXT,
    region TEXT,
    job TEXT,
    golf_experience TEXT,
    interest TEXT,
    referrer TEXT,
    intro TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS event_interests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    event_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS companion_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL REFERENCES users(id),
    target_id INTEGER NOT NULL REFERENCES users(id),
    event_name TEXT NOT NULL,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    phone TEXT,
    channel TEXT NOT NULL DEFAULT 'sms',
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_response TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 복식부기(더블 엔트리) 코인 원장. 거래 하나당 차변(debit) 한 줄 + 대변(credit) 한 줄이
  -- 반드시 짝을 이루어 기록되고(같은 transaction_group), 그 합은 항상 같다.
  -- 회원 잔액은 캐시된 컬럼이 아니라 이 원장에서 매번 계산한다 (원장이 유일한 진실 소스).
  -- account: 'user:<id>' | 'platform:cash' | 'platform:revenue'
  CREATE TABLE IF NOT EXISTS coin_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_group TEXT NOT NULL,
    account TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    user_id INTEGER REFERENCES users(id),
    type TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_coin_ledger_account ON coin_ledger(account);
  CREATE INDEX IF NOT EXISTS idx_coin_ledger_group ON coin_ledger(transaction_group);

  -- 코인 충전 신청. 토스페이먼츠 키가 설정되면 provider='toss'로 자동 승인 시도하고,
  -- 없으면 provider='manual'로 남아 관리자가 입금을 확인하고 수동 승인한다.
  CREATE TABLE IF NOT EXISTS coin_charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount_krw INTEGER NOT NULL,
    coins INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT NOT NULL DEFAULT 'manual',
    provider_order_id TEXT,
    provider_response TEXT,
    admin_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );

  -- attachment_type: NULL(텍스트만) | 'image' | 'file' | 'call'
  -- attachment_url: 이미지/파일은 '/api/messages/attachments/<파일명>', 통화는 Daily.co 방 URL
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    recipient_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    attachment_type TEXT,
    attachment_url TEXT,
    attachment_name TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, created_at);

  -- 고객센터 문의. category: 'complaint'(클레임/불만) | 'refund'(환불 요청) | 'report'(회원 신고) | 'other'(기타)
  -- target_user_id는 'report' 신고 대상, coin_charge_id는 'refund'가 참조하는 충전 내역(선택).
  CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    target_user_id INTEGER REFERENCES users(id),
    coin_charge_id INTEGER REFERENCES coin_charges(id),
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    refund_coins INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id, created_at);

  -- 본인 인증(신분증 확인) 신청. document_url은 관리자와 본인만 열람 가능한 비공개 경로.
  -- 승인되면 users.verified_identity_at이 채워지고, 반려되면 사유와 함께 재신청할 수 있다.
  CREATE TABLE IF NOT EXISTS identity_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    document_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_identity_verifications_user ON identity_verifications(user_id, created_at);

  -- 관리자가 카카오톡으로 보낸 단체/개별 메시지 발송 이력.
  -- type: 'alimtalk'(정보성, 승인된 템플릿) | 'friendtalk'(친구톡, 광고성이라 수신 동의 회원에게만)
  -- audience: 'all' | 'user' | 'interest_golf' | 'interest_travel' | 'approved' | 'verified'
  CREATE TABLE IF NOT EXISTS kakao_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    audience TEXT NOT NULL,
    target_user_id INTEGER REFERENCES users(id),
    message TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    sent INTEGER NOT NULL DEFAULT 0,
    mocked INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    skipped_no_consent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 이용약관/개인정보처리방침/연령확인/광고성정보 동의 이력. 절대 덮어쓰지 않고 매번 새 행을 추가한다
  -- (동의 철회도 agreed=0인 새 행으로 기록). 분쟁 시 "언제, 어떤 버전에, 어떤 경로로" 동의했는지의 유일한 증거.
  CREATE TABLE IF NOT EXISTS consent_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    consent_type TEXT NOT NULL CHECK (consent_type IN ('age19','terms','privacy','marketing')),
    agreed INTEGER NOT NULL CHECK (agreed IN (0,1)),
    document_version TEXT,
    ip_address TEXT,
    user_agent TEXT,
    channel TEXT NOT NULL DEFAULT 'signup' CHECK (channel IN ('signup','settings','re_consent')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_consent_logs_user ON consent_logs(user_id, consent_type, created_at);

  -- 모임 참석 확정 시 코인을 "차감"이 아니라 "보류"로 다룬다(운영정책 권고).
  -- hold_coins는 원장을 건드리지 않고, 실제 coin_ledger 차감은 몰수(취소 페널티/무단불참)가 확정되는 시점에만 일어난다.
  CREATE TABLE IF NOT EXISTS event_attendances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    event_name TEXT NOT NULL,
    event_date TEXT NOT NULL,
    hold_coins INTEGER NOT NULL,
    hold_free_coins INTEGER NOT NULL DEFAULT 0,
    hold_paid_coins INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','attended','no_show')),
    released_pct INTEGER,
    penalty_krw INTEGER,
    penalty_note TEXT,
    cancelled_at TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_event_attendances_user ON event_attendances(user_id, status);

  -- 운영정책 문서가 [미정]으로 남긴 값(무료코인 지급량 등)을 관리자가 나중에 채워 넣는 key/value 설정.
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// CREATE TABLE IF NOT EXISTS는 이미 존재하는 테이블에 새 컬럼을 추가해주지 않으므로,
// 이미 만들어진 로컬 DB에도 이후 추가된 컬럼이 반영되도록 가벼운 마이그레이션을 돌린다.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('messages', 'attachment_type', 'TEXT');
ensureColumn('messages', 'attachment_url', 'TEXT');
ensureColumn('messages', 'attachment_name', 'TEXT');
ensureColumn('messages', 'read_at', 'TEXT');
ensureColumn('users', 'suspended_at', 'TEXT');
ensureColumn('users', 'suspended_reason', 'TEXT');
ensureColumn('users', 'photo_url', 'TEXT');
ensureColumn('users', 'verified_identity_at', 'TEXT');
ensureColumn('users', 'verified_employment_at', 'TEXT');
ensureColumn('users', 'verified_golf_at', 'TEXT');
// 광고성 정보(카카오톡 친구톡·문자) 수신 동의 일시. NULL이면 미동의라 광고성 메시지를 보내면 안 된다.
ensureColumn('users', 'marketing_opt_in_at', 'TEXT');
ensureColumn('notifications', 'campaign_id', 'INTEGER');

// 이용약관/운영정책이 요구하는 필드. 기존 회원은 이 값들이 비어 있는 채로 남고,
// 앱은 그 경우를 "레거시 회원(재입력 필요)"으로 취급한다 — 강제로 지어내지 않는다.
ensureColumn('users', 'nickname', 'TEXT');
ensureColumn('users', 'birth_date', 'TEXT');
ensureColumn('users', 'gender', 'TEXT');
ensureColumn('users', 'marital_status', 'TEXT');
// status: 'pending'(심사중) | 'approved'(승인) | 'rejected'(거절). 컬럼을 처음 추가할 때
// 이미 서비스 중이던 회원까지 심사 대기로 밀어넣지 않기 위해 DEFAULT를 'approved'로 둔다.
// 이후의 신규 가입은 INSERT 문에서 명시적으로 'pending'을 넣는다.
ensureColumn('users', 'status', `TEXT NOT NULL DEFAULT 'approved'`);
ensureColumn('users', 'rejected_at', 'TEXT');
ensureColumn('users', 'rejected_reason', 'TEXT');
ensureColumn('users', 'withdrawn_at', 'TEXT');

// coin_type: 'free'(무료 지급) | 'paid'(구매/충전). 기존에 쌓인 691건은 전부 실제 충전·소비였으므로
// 'paid' 기본값으로 백필해도 회계상 맞다.
ensureColumn('coin_ledger', 'coin_type', `TEXT NOT NULL DEFAULT 'paid' CHECK (coin_type IN ('free','paid'))`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(recipient_id, read_at);`);

// 닉네임은 다른 회원에게 노출되는 유일한 식별자라 유니크해야 하는데, 컬럼을 막 추가한 시점에는
// 기존 회원의 닉네임이 전부 NULL이다(SQLite 유니크 인덱스는 NULL끼리는 서로 충돌하지 않으므로 인덱스 생성 자체는 안전).
// 다만 그 상태로 두면 공개 화면에 빈 이름이 노출되므로, 최소한의 임시 닉네임을 1회성으로 채워준다.
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname) WHERE nickname IS NOT NULL;`);
db.prepare(`UPDATE users SET nickname = '게스트' || id WHERE nickname IS NULL`).run();

// 운영정책 문서가 수량을 [미정]으로 남긴 항목들. 관리자가 값을 정할 때까지는 0(미지급)으로 둔다 —
// 문서에 없는 숫자를 임의로 만들어 지급하지 않기 위함.
const insertSettingIfMissing = db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`);
insertSettingIfMissing.run('welcome_coins_male', '0');
insertSettingIfMissing.run('welcome_coins_female', '0');
insertSettingIfMissing.run('daily_checkin_coins', '0');

module.exports = db;
