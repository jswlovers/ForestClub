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

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    recipient_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, created_at);
`);

module.exports = db;
