import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';

let db: DatabaseSync | null = null;

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'owner')),
  avatar_url TEXT,
  bio TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  banned INTEGER NOT NULL DEFAULT 0,
  supporter INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_recovery TEXT,
  totp_confirmed_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  audio_url TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 0,
  uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended', 'rejected', 'approved')),
  rejection_reason TEXT,
  genre TEXT,
  license TEXT NOT NULL DEFAULT 'all rights reserved',
  bitrate INTEGER NOT NULL DEFAULT 0,
  sample_rate INTEGER NOT NULL DEFAULT 0,
  bit_depth INTEGER NOT NULL DEFAULT 0,
  codec TEXT,
  container TEXT,
  lossless INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  track_id INTEGER,
  track_title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  ts REAL NOT NULL DEFAULT 0,
  reply_to INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  likes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comment_likes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, comment_id)
);

CREATE TABLE IF NOT EXISTS reposts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);

CREATE TABLE IF NOT EXISTS track_plays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id INTEGER,
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS track_delete_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by INTEGER
);

CREATE TABLE IF NOT EXISTS removal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  server TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  requested_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  cancelled_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);
CREATE INDEX IF NOT EXISTS idx_tracks_created ON tracks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_uploader ON tracks(uploader_id);
CREATE INDEX IF NOT EXISTS idx_tracks_audio_url ON tracks(audio_url);
CREATE INDEX IF NOT EXISTS idx_tracks_cover_url ON tracks(cover_url);
CREATE INDEX IF NOT EXISTS idx_likes_track ON likes(track_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_track ON comments(track_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_reposts_track ON reposts(track_id);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
CREATE INDEX IF NOT EXISTS idx_track_plays_track ON track_plays(track_id);
CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_log_actor ON admin_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_removal_status ON removal_requests(status);
CREATE INDEX IF NOT EXISTS idx_tdr_status ON track_delete_requests(status);
`;

const TRACKS_NEW = `
CREATE TABLE tracks_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  audio_url TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 0,
  uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'suspended', 'rejected', 'approved')),
  rejection_reason TEXT,
  genre TEXT,
  license TEXT NOT NULL DEFAULT 'all rights reserved',
  bitrate INTEGER NOT NULL DEFAULT 0,
  sample_rate INTEGER NOT NULL DEFAULT 0,
  bit_depth INTEGER NOT NULL DEFAULT 0,
  codec TEXT,
  container TEXT,
  lossless INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

// Replace a table with a rebuilt copy of the same name (the new DDL lives in
// `createSql`, the data copy in `insertSql`). Foreign keys are suspended so
// other tables referencing this one keep resolving after the rename.
function rebuildTable(db: DatabaseSync, name: string, createSql: string, insertSql: string) {
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    // The whole swap runs inside a transaction: a failure mid-way rolls back
    // and leaves the original table (and its data) intact.
    db.exec('BEGIN;');
    try {
      db.exec(`DROP TABLE IF EXISTS ${name}_new;`);
      db.exec(createSql);
      db.exec(insertSql);
      db.exec(`DROP TABLE ${name};`);
      db.exec(`ALTER TABLE ${name}_new RENAME TO ${name};`);
      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw e;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

// Old databases had a tracks CHECK constraint that only allowed
// pending/approved/rejected. Rebuild the table to accept the new statuses.
function migrateTracks(db: DatabaseSync) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tracks'").get() as
    | { sql?: string }
    | undefined;
  if (!row || row.sql?.includes('verified')) return;

  rebuildTable(
    db,
    'tracks',
    TRACKS_NEW,
    `
      INSERT INTO tracks_new (id, title, artist, description, cover_url, audio_url, duration, uploader_id, status, rejection_reason, plays, likes, created_at)
      SELECT id, title, artist, description, cover_url, audio_url, duration, uploader_id, status, rejection_reason, plays, likes, created_at FROM tracks;
    `,
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_tracks_status ON tracks(status);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tracks_created ON tracks(created_at DESC);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tracks_uploader ON tracks(uploader_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tracks_audio_url ON tracks(audio_url);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tracks_cover_url ON tracks(cover_url);');
}

const USERS_NEW = `
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'owner')),
  avatar_url TEXT,
  bio TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  banned INTEGER NOT NULL DEFAULT 0,
  supporter INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_recovery TEXT,
  totp_confirmed_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);
`;

// Older databases allowed only 'user'/'admin'. Rebuild users to add the
// 'owner' role. The table name is preserved so existing foreign keys that
// reference users(id) keep resolving.
function migrateRoles(db: DatabaseSync) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as
    | { sql?: string }
    | undefined;
  if (!row || row.sql?.includes('owner')) return;

  rebuildTable(
    db,
    'users',
    USERS_NEW,
    `
      INSERT INTO users_new (id, username, email, password_hash, role, avatar_url, bio, location, banned, supporter, totp_secret, totp_enabled, totp_recovery, totp_confirmed_at, created_at, last_seen)
      SELECT id, username, email, password_hash, role, avatar_url, bio, location, banned, supporter, totp_secret, totp_enabled, totp_recovery, totp_confirmed_at, created_at, last_seen FROM users;
    `,
  );
}

// Add new columns to an existing table without a full rebuild.
// `table` is always a hard-coded literal at the call site.
function addMissingColumns(db: DatabaseSync, table: string, columns: Record<string, string>) {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name),
  );
  for (const [name, ddl] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl};`);
  }
}

function migrateColumns(db: DatabaseSync) {
  addMissingColumns(db, 'tracks', {
    genre: 'TEXT',
    license: "TEXT NOT NULL DEFAULT 'all rights reserved'",
    bitrate: 'INTEGER NOT NULL DEFAULT 0',
    reposts: 'INTEGER NOT NULL DEFAULT 0',
    sample_rate: 'INTEGER NOT NULL DEFAULT 0',
    bit_depth: 'INTEGER NOT NULL DEFAULT 0',
    codec: 'TEXT',
    container: 'TEXT',
    lossless: 'INTEGER NOT NULL DEFAULT 0',
    source: 'TEXT',
    source_url: 'TEXT',
  });
  addMissingColumns(db, 'users', {
    location: "TEXT NOT NULL DEFAULT ''",
    supporter: 'INTEGER NOT NULL DEFAULT 0',
    totp_secret: 'TEXT',
    totp_enabled: 'INTEGER NOT NULL DEFAULT 0',
    totp_recovery: 'TEXT',
    totp_confirmed_at: 'INTEGER',
    last_seen: 'INTEGER',
  });
}

export function getDb(): DatabaseSync {
  if (!db) {
    const dbPath = path.resolve(config.databasePath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath);
    try {
      fs.chmodSync(dbPath, 0o600);
    } catch {
      // chmod is not meaningful on every platform (e.g. Windows); ignore.
    }
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
    // trusted_schema=OFF stops SQLite from invoking user-defined functions
    // baked into the schema — defense in depth against any SQL injection.
    db.exec('PRAGMA trusted_schema = OFF;');
    db.exec(SCHEMA);
    migrateTracks(db);
    migrateColumns(db);
    migrateRoles(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
