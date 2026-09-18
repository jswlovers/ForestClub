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

db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(recipient_id, read_at);`);

module.exports = db;
