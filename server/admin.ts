import fs from 'node:fs';
import path from 'node:path';
import { getDb, closeDb, type DB } from './db';
import { config } from './config';
import { notify } from './notify';
import { auditLog, AuditAction } from './audit';
import { hashPassword } from './auth';
import { resolveInside } from './security';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Actor {
  id: number;
  username: string;
}

type Row = Record<string, any>;

const VALID_STATUSES = ['pending', 'verified', 'suspended', 'rejected', 'approved'] as const;

export type QualityTier = 'standard' | 'hifi' | 'hires';

// Quality categories based on the uploaded file's codec and sample properties.
//   Hi-Res : lossless, 24-bit, 44.1–192 kHz
//   Hi-Fi  : lossless, 16-bit, >= 44.1 kHz (CD quality)
//   Standard / HQ : everything else (Opus/AAC/MP3, up to 320 kbps)
function sampleRateIn(rate: number, min: number, max?: number): boolean {
  if (rate === 0) return true;
  if (rate < min) return false;
  return max === undefined || rate <= max;
}

export function qualityTier(track: Record<string, any>): QualityTier {
  const lossless = Boolean(track.lossless);
  const bits = Number(track.bit_depth ?? 0);
  const rate = Number(track.sample_rate ?? 0);
  if (lossless && bits >= 24 && sampleRateIn(rate, 44100, 192000)) return 'hires';
  if (lossless && bits === 16 && sampleRateIn(rate, 44100)) return 'hifi';
  return 'standard';
}

export function formatQuality(track: { sample_rate?: number | null; bit_depth?: number | null; bitrate?: number | null }): string {
  const khz = Number(track.sample_rate ?? 0);
  const bits = Number(track.bit_depth ?? 0);
  const kbps = Number(track.bitrate ?? 0);
  const rate = khz > 0 ? `${(khz / 1000).toFixed(1).replace(/\.0$/, '')} kHz` : '-';
  const depth = bits > 0 ? `${bits} bit` : '-';
  const br = kbps > 0 ? `${Math.round(kbps / 1000)} kbps` : '-';
  return `${rate} / ${depth} / ${br}`;
}

const TIER_LABELS: Record<QualityTier, string> = {
  standard: 'Standard / HQ',
  hifi: 'Hi-Fi / CD Quality',
  hires: 'Hi-Res',
};

export function qualityTierLabel(tier: QualityTier): string {
  return TIER_LABELS[tier];
}

function trackWithUploader(id: number): Row | undefined {
  return getDb()
    .prepare(
      `SELECT t.*, u.username AS uploader_username, u.avatar_url AS uploader_avatar
       FROM tracks t LEFT JOIN users u ON u.id = t.uploader_id
       WHERE t.id = ?`,
    )
    .get(id) as Row | undefined;
}

function getUserRow(identifier: string): Row {
  const id = Number(identifier);
  const row = (Number.isInteger(id) && id > 0
    ? getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)
    : getDb().prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(String(identifier).toLowerCase())) as
    | Row
    | undefined;
  if (!row) throw new AppError(404, 'User not found');
  return row;
}

function getTrackRow(id: number): Row {
  const row = getDb().prepare('SELECT * FROM tracks WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new AppError(404, 'Track not found');
  return row;
}

function trackUrlToPath(url: string): string | null {
  if (!url.startsWith('/uploads/')) return null;
  return resolveInside(config.uploadDir, url.replace(/^\/uploads\//, ''));
}

export function removeUploadedFiles(urls: (string | null | undefined)[]): void {
  for (const url of urls) {
    if (!url) continue;
    const abs = trackUrlToPath(url);
    if (!abs) continue;
    try {
      fs.rmSync(abs, { force: true });
    } catch {
      /* file already gone */
    }
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function getAdminStats() {
  const db = getDb();
  const overview = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM tracks) AS total_tracks,
        (SELECT COUNT(*) FROM tracks WHERE status = 'pending') AS pending_tracks,
        (SELECT COUNT(*) FROM tracks WHERE status = 'verified') AS verified_tracks,
        (SELECT COUNT(*) FROM tracks WHERE status = 'suspended') AS suspended_tracks,
        (SELECT COUNT(*) FROM tracks WHERE status = 'rejected') AS rejected_tracks,
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM users WHERE banned = 1) AS banned_users,
        (SELECT COALESCE(SUM(plays), 0) FROM tracks) AS total_plays,
        (SELECT COALESCE(SUM(likes), 0) FROM tracks) AS total_likes`,
    )
    .get() as Row;

  const since = Date.now() - 13 * 86400000;
  const recentRows = db
    .prepare(
      `SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS count
       FROM tracks WHERE created_at >= ? GROUP BY day ORDER BY day`,
    )
    .all(since) as Row[];

  const topRows = db
    .prepare(
      `SELECT t.id, t.title, t.artist, t.plays, t.likes, t.cover_url
       FROM tracks t WHERE t.status IN ('verified', 'suspended', 'approved')
       ORDER BY t.plays DESC LIMIT 5`,
    )
    .all() as Row[];

  const auditCount = db.prepare('SELECT COUNT(*) AS n FROM admin_log').get() as { n: number };
  const diskBytes = Math.max(
    0,
    Number((db.prepare('PRAGMA page_count').get() as Row).page_count) *
      Number((db.prepare('PRAGMA page_size').get() as Row).page_size),
  );

  return {
    overview: {
      totalTracks: Number(overview.total_tracks),
      pendingTracks: Number(overview.pending_tracks),
      verifiedTracks: Number(overview.verified_tracks),
      suspendedTracks: Number(overview.suspended_tracks),
      rejectedTracks: Number(overview.rejected_tracks),
      totalUsers: Number(overview.total_users),
      bannedUsers: Number(overview.banned_users),
      totalPlays: Number(overview.total_plays),
      totalLikes: Number(overview.total_likes),
    },
    recentUploads: recentRows.map((r) => ({ day: String(r.day), count: Number(r.count) })),
    topTracks: topRows.map((r) => ({
      id: Number(r.id),
      title: String(r.title),
      artist: String(r.artist),
      plays: Number(r.plays),
      likes: Number(r.likes),
      coverUrl: r.cover_url ?? null,
    })),
    auditEntries: Number(auditCount.n),
    dbBytes: diskBytes,
  };
}

export function getUserSummary(identifier: string) {
  const user = getUserRow(identifier);
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM tracks WHERE uploader_id = ?) AS tracks,
        (SELECT COALESCE(SUM(plays), 0) FROM tracks WHERE uploader_id = ?) AS plays,
        (SELECT COALESCE(SUM(likes), 0) FROM tracks WHERE uploader_id = ?) AS likes,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
        (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers`,
    )
    .get(user.id, user.id, user.id, user.id, user.id) as Row;
  return { user, counts };
}

export function getTrackSummary(id: number) {
  const row = trackWithUploader(id);
  if (!row) throw new AppError(404, 'Track not found');
  const fans = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS n FROM track_plays WHERE track_id = ? AND user_id IS NOT NULL`,
    )
    .get(id) as { n: number };
  return { track: row, fanCount: Number(fans.n) };
}

// ---------------------------------------------------------------------------
// Track moderation
// ---------------------------------------------------------------------------

function trackAudit(action: AuditAction, track: Row, actor: Actor | null, detail?: string) {
  auditLog({
    action,
    actorId: actor?.id ?? null,
    actorName: actor?.username ?? null,
    targetType: 'track',
    targetId: Number(track.id),
    detail: detail ?? `${String(track.title)} by ${String(track.artist)}`,
  });
}

export function verifyTrack(id: number, actor: Actor | null): Row {
  const track = getTrackRow(id);
  const db = getDb();
  if (track.status === 'rejected') {
    db.prepare(
      "UPDATE tracks SET status = 'verified', rejection_reason = NULL, created_at = ? WHERE id = ?",
    ).run(Date.now(), id);
  } else {
    db.prepare("UPDATE tracks SET status = 'verified', rejection_reason = NULL WHERE id = ?").run(id);
  }
  notify(Number(track.uploader_id), {
    type: 'track_verified',
    trackId: id,
    trackTitle: String(track.title),
    message: `Your track "${track.title}" was verified and is now public`,
  });
  trackAudit('track.verify', track, actor);
  return getTrackRow(id);
}

export function suspendTrack(id: number, actor: Actor | null): Row {
  const track = getTrackRow(id);
  if (track.status === 'suspended') throw new AppError(400, 'Track is already suspended');
  getDb().prepare("UPDATE tracks SET status = 'suspended' WHERE id = ?").run(id);
  notify(Number(track.uploader_id), {
    type: 'track_suspended',
    trackId: id,
    trackTitle: String(track.title),
    message: `Your track "${track.title}" was suspended — playback is temporarily disabled`,
  });
  trackAudit('track.suspend', track, actor);
  return getTrackRow(id);
}

export function unsuspendTrack(id: number, actor: Actor | null): Row {
  const track = getTrackRow(id);
  if (track.status !== 'suspended') throw new AppError(400, 'Track is not suspended');
  getDb().prepare("UPDATE tracks SET status = 'verified' WHERE id = ?").run(id);
  notify(Number(track.uploader_id), {
    type: 'track_unsuspended',
    trackId: id,
    trackTitle: String(track.title),
    message: `Your track "${track.title}" was reinstated — playback is enabled again`,
  });
  trackAudit('track.unsuspend', track, actor);
  return getTrackRow(id);
}

export function rejectTrack(id: number, reason: string, actor: Actor | null): Row {
  if (!reason) throw new AppError(400, 'Rejection reason is required');
  const track = getTrackRow(id);
  getDb().prepare('UPDATE tracks SET status = ?, rejection_reason = ? WHERE id = ?').run('rejected', reason, id);
  notify(Number(track.uploader_id), {
    type: 'track_rejected',
    trackId: id,
    trackTitle: String(track.title),
    message: `Your track "${track.title}" was rejected: ${reason}`,
  });
  trackAudit('track.reject', track, actor, reason);
  return getTrackRow(id);
}

export function deleteTrack(id: number, actor: Actor | null): Row {
  const track = getTrackRow(id);
  const deletedByAdmin = actor !== null && Number(track.uploader_id) !== actor.id;
  removeUploadedFiles([track.audio_url, track.cover_url]);
  getDb().prepare('DELETE FROM tracks WHERE id = ?').run(id);
  if (deletedByAdmin) {
    notify(Number(track.uploader_id), {
      type: 'track_deleted',
      trackId: id,
      trackTitle: String(track.title),
      message: `Your track "${track.title}" was deleted by a moderator`,
    });
  }
  trackAudit('track.delete', track, actor);
  return track;
}

export function resubmitTrack(id: number, actor: Actor | null): Row {
  const track = getTrackRow(id);
  if (track.status !== 'rejected') throw new AppError(400, 'Only rejected tracks can be resubmitted');
  getDb().prepare("UPDATE tracks SET status = 'pending', rejection_reason = NULL WHERE id = ?").run(id);
  trackAudit('track.resubmit', track, actor);
  return getTrackRow(id);
}

export function listTracksForModeration(status: string) {
  if (status !== 'all' && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    throw new AppError(400, 'Invalid status');
  }
  const base = `SELECT t.*, u.username AS uploader_username, u.avatar_url AS uploader_avatar FROM tracks t
    LEFT JOIN users u ON u.id = t.uploader_id`;
  const rows =
    status === 'all'
      ? (getDb().prepare(`${base} ORDER BY t.created_at DESC`).all() as Row[])
      : (getDb()
          .prepare(`${base} WHERE t.status = ? ORDER BY t.created_at DESC`)
          .all(status) as Row[]);
  return rows;
}

// ---------------------------------------------------------------------------
// Track deletion requests (admin requests → owner approves/rejects)
// ---------------------------------------------------------------------------

export interface TrackDeleteRequest {
  id: number;
  trackId: number;
  trackTitle: string;
  trackArtist: string;
  trackUploaderId: number | null;
  requestedBy: number;
  requestedByUsername: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  decidedAt: number | null;
  decidedBy: number | null;
  decidedByUsername: string | null;
}

const DELETE_REQUEST_SELECT = `
  SELECT r.*, u.username AS requested_username, du.username AS decided_username,
         t.title AS track_title, t.artist AS track_artist, t.uploader_id AS track_uploader_id
  FROM track_delete_requests r
  LEFT JOIN users u ON u.id = r.requested_by
  LEFT JOIN users du ON du.id = r.decided_by
  LEFT JOIN tracks t ON t.id = r.track_id
`;

function mapDeleteRequest(row: Row): TrackDeleteRequest {
  return {
    id: Number(row.id),
    trackId: Number(row.track_id),
    trackTitle: String(row.track_title ?? 'Deleted track'),
    trackArtist: String(row.track_artist ?? ''),
    trackUploaderId: row.track_uploader_id != null ? Number(row.track_uploader_id) : null,
    requestedBy: Number(row.requested_by),
    requestedByUsername: row.requested_username ?? null,
    reason: String(row.reason ?? ''),
    status: row.status as TrackDeleteRequest['status'],
    createdAt: Number(row.created_at),
    decidedAt: row.decided_at != null ? Number(row.decided_at) : null,
    decidedBy: row.decided_by != null ? Number(row.decided_by) : null,
    decidedByUsername: row.decided_username ?? null,
  };
}

function getDeleteRequest(id: number): TrackDeleteRequest {
  const row = getDb().prepare(`${DELETE_REQUEST_SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
  if (!row) throw new AppError(404, 'Delete request not found');
  return mapDeleteRequest(row);
}

export function requestTrackDeletion(trackId: number, reason: string, actor: Actor): TrackDeleteRequest {
  const track = getTrackRow(trackId);
  const db = getDb();
  const pending = db
    .prepare("SELECT id FROM track_delete_requests WHERE track_id = ? AND status = 'pending'")
    .get(trackId) as Row | undefined;
  if (pending) throw new AppError(400, 'A delete request for this track is already pending');
  const info = db
    .prepare(
      'INSERT INTO track_delete_requests (track_id, requested_by, reason, status, created_at) VALUES (?,?,?,?,?)',
    )
    .run(trackId, actor.id, reason.trim().slice(0, 500), 'pending', Date.now());
  trackAudit(
    'track.delete-request',
    track,
    actor,
    reason.trim() ? `requested by ${actor.username} — ${reason.trim()}` : `requested by ${actor.username}`,
  );
  return getDeleteRequest(Number(info.lastInsertRowid));
}

export function listTrackDeleteRequests(): TrackDeleteRequest[] {
  const rows = getDb()
    .prepare(`${DELETE_REQUEST_SELECT} ORDER BY (r.status = 'pending') DESC, r.created_at DESC`)
    .all() as Row[];
  return rows.map(mapDeleteRequest);
}

export function approveTrackDeletionRequest(id: number, actor: Actor): TrackDeleteRequest {
  const req = getDeleteRequest(id);
  if (req.status !== 'pending') throw new AppError(400, 'Request is already decided');
  const track = getTrackRow(req.trackId);
  getDb()
    .prepare("UPDATE track_delete_requests SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ?")
    .run(Date.now(), actor.id, id);
  deleteTrack(req.trackId, actor);
  auditLog({
    action: 'track.delete-approve',
    actorId: actor.id,
    actorName: actor.username,
    targetType: 'track',
    targetId: req.trackId,
    detail: `request #${id} — ${String(track.title)} by ${String(track.artist)}`,
  });
  return { ...req, status: 'approved', decidedAt: Date.now(), decidedBy: actor.id };
}

export function rejectTrackDeletionRequest(id: number, actor: Actor): TrackDeleteRequest {
  const req = getDeleteRequest(id);
  if (req.status !== 'pending') throw new AppError(400, 'Request is already decided');
  getDb()
    .prepare("UPDATE track_delete_requests SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?")
    .run(Date.now(), actor.id, id);
  auditLog({
    action: 'track.delete-reject',
    actorId: actor.id,
    actorName: actor.username,
    targetType: 'track',
    targetId: req.trackId,
    detail: `request #${id} — ${req.trackTitle}`,
  });
  return getDeleteRequest(id);
}

// ---------------------------------------------------------------------------
// User administration
// ---------------------------------------------------------------------------

function userAudit(action: AuditAction, user: Row, actor: Actor | null, detail?: string) {
  auditLog({
    action,
    actorId: actor?.id ?? null,
    actorName: actor?.username ?? null,
    targetType: 'user',
    targetId: Number(user.id),
    detail: detail ?? String(user.username),
  });
}

// Moderators must never edit their own account or an owner account. The CLI
// (actor = null) also cannot touch owner accounts, but may self-serve.
function assertCanModify(actor: Actor | null, user: Row, ownerDenied: string): void {
  if (actor && Number(user.id) === actor.id) throw new AppError(400, 'You cannot modify your own account');
  if (user.role !== 'owner') return;
  if (actor) {
    const actorRow = getDb().prepare('SELECT role FROM users WHERE id = ?').get(actor.id) as Row | undefined;
    if (!actorRow || actorRow.role !== 'owner') throw new AppError(403, 'Owner accounts cannot be modified by moderators');
  } else {
    throw new AppError(400, ownerDenied);
  }
}

export function setUserBanned(identifier: string, banned: boolean, actor: Actor | null): Row {
  const user = getUserRow(identifier);
  assertCanModify(actor, user, 'Owner accounts cannot be banned');
  getDb().prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, user.id);
  userAudit(banned ? 'user.ban' : 'user.unban', user, actor, String(user.username));
  return getUserRow(String(user.id));
}

export function setUserRole(identifier: string, role: 'user' | 'admin', actor: Actor | null): Row {
  const user = getUserRow(identifier);
  assertCanModify(actor, user, 'Owner accounts cannot be promoted or demoted');
  if (user.role === role) return user;
  getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  userAudit(role === 'admin' ? 'user.promote' : 'user.demote', user, actor, String(user.username));
  return getUserRow(String(user.id));
}

export function setUserSupporter(identifier: string, enabled: boolean, actor: Actor | null): Row {
  const user = getUserRow(identifier);
  if (user.role === 'owner') throw new AppError(400, 'Owner accounts always have full access');
  if (Boolean(user.supporter) === enabled) return user;
  getDb().prepare('UPDATE users SET supporter = ? WHERE id = ?').run(enabled ? 1 : 0, user.id);
  userAudit('user.supporter', user, actor, enabled ? `granted to ${user.username}` : `revoked from ${user.username}`);
  return getUserRow(String(user.id));
}

export function resetUserPassword(identifier: string, password: string, actor: Actor | null): Row {
  if (!password || password.length < 6) throw new AppError(400, 'Password must be at least 6 characters');
  const user = getUserRow(identifier);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
  userAudit('user.password', user, actor, String(user.username));
  return getUserRow(String(user.id));
}

export function listUsers() {
  const rows = getDb()
    .prepare(
      `SELECT u.*, COUNT(t.id) AS track_count
       FROM users u LEFT JOIN tracks t ON t.uploader_id = u.id
       GROUP BY u.id ORDER BY u.created_at DESC`,
    )
    .all() as Row[];
  return rows;
}

export function notifyUser(identifier: string, message: string, actor: Actor | null): Row {
  if (!message.trim()) throw new AppError(400, 'Message cannot be empty');
  const user = getUserRow(identifier);
  notify(Number(user.id), { type: 'admin_message', trackTitle: '', message: message.trim().slice(0, 2000) });
  auditLog({
    action: 'notify',
    actorId: actor?.id ?? null,
    actorName: actor?.username ?? null,
    targetType: 'user',
    targetId: Number(user.id),
    detail: message.trim().slice(0, 300),
  });
  return user;
}

// ---------------------------------------------------------------------------
// Maintenance (CLI-only)
// ---------------------------------------------------------------------------

// Accounts created before the activity tracker existed have no `last_seen`.
// Derive it from their latest activity across all interaction tables (falls
// back to the account's creation time) so the purge sees a truthful picture.
export function backfillLastSeen(): number {
  const db = getDb();
  const users = db.prepare('SELECT id, created_at FROM users WHERE last_seen IS NULL').all() as Row[];
  if (users.length === 0) return 0;

  const interactions = [
    { table: 'track_plays', col: 'user_id' },
    { table: 'comments', col: 'user_id' },
    { table: 'likes', col: 'user_id' },
    { table: 'reposts', col: 'user_id' },
    { table: 'follows', col: 'follower_id' },
    { table: 'track_delete_requests', col: 'requested_by' },
  ] as const;

  const latestByUser = new Map<number, number>();
  for (const { table, col } of interactions) {
    const rows = db
      .prepare(`SELECT ${col} AS uid, MAX(created_at) AS last FROM ${table} GROUP BY ${col}`)
      .all() as Row[];
    for (const row of rows) {
      if (row.last == null) continue;
      const uid = Number(row.uid);
      const prev = latestByUser.get(uid);
      const next = Number(row.last);
      if (prev === undefined || next > prev) latestByUser.set(uid, next);
    }
  }

  const update = db.prepare('UPDATE users SET last_seen = ? WHERE id = ?');
  let updated = 0;
  for (const u of users) {
    const latest = Math.max(Number(u.created_at), latestByUser.get(Number(u.id)) ?? 0);
    update.run(latest, Number(u.id));
    updated += 1;
  }
  return updated;
}

export interface InactiveAccount {
  id: number;
  username: string;
  email: string | null;
  role: string;
  banned: boolean;
  supporter: boolean;
  lastSeen: number | null;
  createdAt: number;
  trackCount: number;
}

export interface PurgeResult {
  candidates: InactiveAccount[];
  deleted: boolean;
  cutoff: number;
  backfilled: number;
}

// Find accounts with no activity for `months` (default semantics of "used" =
// any interaction: logins, page views, plays, comments, likes, uploads).
// Owner accounts are always excluded; admins and supporters are excluded
// unless explicitly included. Deleting a user keeps their tracks (the FK on
// tracks.uploader_id sets it to NULL), and cascades away likes, comments,
// reposts, follows, notifications and pending delete requests.
export function deleteUsers(db: DB, ids: number[]) {
  db.exec('BEGIN');
  try {
    for (const id of ids) {
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function collectInactiveCandidates(db: DB, cutoff: number, opts: {
  includeAdmins?: boolean;
  includeSupporters?: boolean;
}): InactiveAccount[] {
  const conditions = ["u.role != 'owner'", 'u.last_seen IS NOT NULL', 'u.last_seen < ?'];
  if (!opts.includeAdmins) conditions.push("u.role != 'admin'");
  if (!opts.includeSupporters) conditions.push('u.supporter = 0');

  const rows = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM tracks t WHERE t.uploader_id = u.id) AS track_count
       FROM users u WHERE ${conditions.join(' AND ')} ORDER BY u.last_seen ASC`,
    )
    .all(cutoff) as Row[];

  return rows.map((r) => ({
    id: Number(r.id),
    username: String(r.username),
    email: r.email != null ? String(r.email) : null,
    role: String(r.role),
    banned: Boolean(r.banned),
    supporter: Boolean(r.supporter),
    lastSeen: r.last_seen != null ? Number(r.last_seen) : null,
    createdAt: Number(r.created_at),
    trackCount: Number(r.track_count),
  }));
}

export function purgeInactiveAccounts(opts: {
  months: number;
  performDelete: boolean;
  includeAdmins?: boolean;
  includeSupporters?: boolean;
}): PurgeResult {
  const db = getDb();
  if (!Number.isFinite(opts.months) || opts.months <= 0) {
    throw new AppError(400, 'months must be a positive number');
  }
  const backfilled = backfillLastSeen();
  const cutoff = Date.now() - opts.months * 30.4375 * 86400000;

  const candidates = collectInactiveCandidates(db, cutoff, opts);

  if (opts.performDelete && candidates.length > 0) {
    deleteUsers(db, candidates.map((c) => c.id));
    auditLog({
      action: 'user.purge',
      detail: `${candidates.length} account(s) inactive for > ${opts.months} month(s) deleted`,
    });
  }

  return { candidates, deleted: opts.performDelete, cutoff, backfilled };
}

export function vacuumMaintenance() {
  const db = getDb();
  const integrity = (db.prepare('PRAGMA integrity_check').get() as Row).integrity_check;
  const before = Number((db.prepare('PRAGMA page_count').get() as Row).page_count);
  db.exec('VACUUM');
  const after = Number((db.prepare('PRAGMA page_count').get() as Row).page_count);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* WAL already truncated */
  }
  auditLog({ action: 'vacuum', detail: `pages ${before} -> ${after}` });
  return { integrity, pagesBefore: before, pagesAfter: after };
}

function copyDir(src: string, dest: string): number {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      count += 1;
    }
  }
  return count;
}

export function backupDatabase(outDir?: string) {
  const db = getDb();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultDir = path.resolve(path.dirname(config.databasePath), '..', 'backups', `open-audio-${timestamp}`);
  const dir = outDir ? path.resolve(outDir) : defaultDir;
  fs.mkdirSync(dir, { recursive: true });

  const snapshotPath = path.join(dir, 'open-audio.db');
  if (fs.existsSync(snapshotPath)) {
    throw new AppError(400, `Snapshot already exists at ${snapshotPath} — pick a different output directory`);
  }
  db.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);

  const uploadsDir = path.resolve(config.uploadDir);
  const copied = copyDir(uploadsDir, path.join(dir, 'uploads'));

  auditLog({ action: 'backup', detail: dir });
  return { dir, snapshotPath, uploadsCopied: copied };
}

export function restoreDatabase(sourceDir: string, opts: { force: boolean }) {
  const src = path.resolve(sourceDir);
  if (!fs.existsSync(path.join(src, 'open-audio.db'))) {
    throw new AppError(400, `No open-audio.db found in ${src}`);
  }
  if (!opts.force) throw new AppError(400, 'This overwrites the current database — pass --force to confirm');

  closeDb();
  try {
    const dbPath = path.resolve(config.databasePath);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.copyFileSync(path.join(src, 'open-audio.db'), dbPath);
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(dbPath + suffix, { force: true });
    }
    const uploadsSrc = path.join(src, 'uploads');
    if (fs.existsSync(uploadsSrc)) {
      fs.rmSync(path.resolve(config.uploadDir), { recursive: true, force: true });
      fs.mkdirSync(path.resolve(config.uploadDir), { recursive: true });
      copyDir(uploadsSrc, path.resolve(config.uploadDir));
    }
  } finally {
    getDb();
  }
  auditLog({ action: 'restore', detail: src });
  return { restored: src };
}

function collectOrphans(uploadRoot: string, used: Set<string>): { file: string; bytes: number }[] {
  const orphans: { file: string; bytes: number }[] = [];
  if (!fs.existsSync(uploadRoot)) return orphans;
  for (const sub of fs.readdirSync(uploadRoot)) {
    const subPath = path.join(uploadRoot, sub);
    if (!fs.statSync(subPath).isDirectory()) continue;
    for (const file of fs.readdirSync(subPath)) {
      const rel = `/uploads/${sub}/${file}`;
      if (!used.has(rel)) {
        orphans.push({ file: rel, bytes: fs.statSync(path.join(subPath, file)).size });
      }
    }
  }
  return orphans;
}

function deleteOrphans(uploadRoot: string, orphans: { file: string; bytes: number }[]) {
  for (const orphan of orphans) {
    const abs = resolveInside(uploadRoot, orphan.file.replace(/^\/uploads\//, ''));
    if (abs) fs.rmSync(abs, { force: true });
  }
}

export function pruneOrphans(dryRun: boolean) {
  const db = getDb();
  const used = new Set<string>();
  const rows = db
    .prepare(`SELECT audio_url, cover_url FROM tracks WHERE audio_url LIKE '/uploads/%' OR cover_url LIKE '/uploads/%'`)
    .all() as Row[];
  for (const row of rows) {
    if (row.audio_url) used.add(String(row.audio_url));
    if (row.cover_url) used.add(String(row.cover_url));
  }

  const uploadRoot = path.resolve(config.uploadDir);
  const orphans = collectOrphans(uploadRoot, used);

  if (!dryRun) deleteOrphans(uploadRoot, orphans);
  auditLog({ action: 'prune', detail: `${orphans.length} file(s) ${dryRun ? 'reported' : 'deleted'}` });
  return { orphans, deleted: !dryRun };
}
