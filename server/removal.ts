import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, closeDb } from './db';
import { config } from './config';
import { auditLog } from './audit';
import { AppError, Actor } from './admin';

type Row = Record<string, any>;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyRemovalKey(key: string): void {
  if (!config.removalKey) {
    throw new AppError(503, 'Server removal is not configured (REMOVAL_KEY is empty)');
  }
  if (!safeEqual(key, config.removalKey)) {
    throw new AppError(401, 'Invalid removal key');
  }
}

function parseHashes(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function toRemovalRequest(row: Row) {
  return {
    id: Number(row.id),
    requestId: String(row.request_id),
    server: String(row.server ?? ''),
    reason: String(row.reason ?? ''),
    status: String(row.status),
    requestedAt: Number(row.requested_at),
    confirmedAt: row.confirmed_at != null ? Number(row.confirmed_at) : null,
    cancelledAt: row.cancelled_at != null ? Number(row.cancelled_at) : null,
  };
}

// CLI utility sends a removal request protected by the special removal key.
export function createRemovalRequest(key: string, reason: string) {
  verifyRemovalKey(key);

  const db = getDb();
  const pending = db
    .prepare("SELECT id FROM removal_requests WHERE status = 'pending' LIMIT 1")
    .get() as Row | undefined;
  if (pending) {
    throw new AppError(409, 'A removal request is already pending — handle it in the admin panel first');
  }

  const requestId = crypto.randomBytes(16).toString('hex');
  const info = db
    .prepare('INSERT INTO removal_requests (request_id, server, reason, status, requested_at) VALUES (?,?,?,?,?)')
    .run(
      requestId,
      `${os.hostname()} (${os.platform()} ${os.release()}) · ${config.appUrl}`,
      reason.slice(0, 500),
      'pending',
      Date.now(),
    );

  auditLog({
    actorId: null,
    actorName: 'removal-utility',
    action: 'removal.request',
    targetType: 'removal_request',
    targetId: Number(info.lastInsertRowid),
    detail: `request_id ${requestId}`,
  });

  const row = db.prepare('SELECT * FROM removal_requests WHERE id = ?').get(Number(info.lastInsertRowid)) as Row;
  return toRemovalRequest(row);
}

export function listRemovalRequests() {
  const rows = getDb()
    .prepare('SELECT * FROM removal_requests ORDER BY requested_at DESC')
    .all() as Row[];
  return rows.map(toRemovalRequest);
}

// Owner dismisses a pending removal request.
export function cancelRemovalRequest(id: number, actor: Actor) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM removal_requests WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new AppError(404, 'Removal request not found');
  if (row.status !== 'pending') throw new AppError(409, 'This removal request is no longer pending');

  db.prepare("UPDATE removal_requests SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(Date.now(), id);

  auditLog({
    actorId: actor.id,
    actorName: actor.username,
    action: 'removal.cancel',
    targetType: 'removal_request',
    targetId: id,
  });

  const updated = db.prepare('SELECT * FROM removal_requests WHERE id = ?').get(id) as Row;
  return toRemovalRequest(updated);
}

// Owner confirms with the removal key. This wipes the database, uploads,
// production build and .env, then shuts the process down.
export function confirmRemovalRequest(id: number, key: string, actor: Actor) {
  verifyRemovalKey(key);

  const db = getDb();
  const row = db.prepare('SELECT * FROM removal_requests WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new AppError(404, 'Removal request not found');
  if (row.status !== 'pending') throw new AppError(409, 'This removal request is no longer pending');

  db.prepare("UPDATE removal_requests SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(Date.now(), id);

  auditLog({
    actorId: actor.id,
    actorName: actor.username,
    action: 'removal.confirm',
    targetType: 'removal_request',
    targetId: id,
    detail: `request_id ${String(row.request_id)} — full removal triggered`,
  });

  performUninstall();
  return { ok: true };
}

function performUninstall(): void {
  const dbPath = path.resolve(config.databasePath);
  const targets = [
    dbPath,
    `${dbPath}-wal`,
    `${dbPath}-shm`,
    path.resolve(config.uploadDir),
    path.resolve('dist'),
    path.resolve('.env'),
  ];

  // Close the DB first so the files are not locked (Windows).
  closeDb();

  for (const target of targets) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[open-audio] removed ${target}`);
    } catch (e) {
      console.error(`[open-audio] failed to remove ${target}`, e);
    }
  }

  console.log('[open-audio] Server removal complete. Goodbye.');
  setTimeout(() => process.exit(0), 300);
}
