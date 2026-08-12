import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { getDb, closeDb } from '../server/db';
import { config } from '../server/config';
import { upsertAdmin, upsertOwner } from '../server/seed';
import { auditLog } from '../server/audit';
import { resolveInside } from '../server/security';
import { readAudioMeta } from '../server/media';
import { root, formatBytes, formatDate, randomPassword, readEnv, writeEnv } from './env';
import {
  AppError,
  backupDatabase,
  deleteTrack,
  formatQuality,
  getAdminStats,
  getTrackSummary,
  getUserSummary,
  listTracksForModeration,
  listUsers,
  notifyUser,
  pruneOrphans,
  purgeInactiveAccounts,
  qualityTier,
  qualityTierLabel,
  rejectTrack,
  resetUserPassword,
  resubmitTrack,
  restoreDatabase,
  setUserBanned,
  setUserRole,
  setUserSupporter,
  suspendTrack,
  unsuspendTrack,
  vacuumMaintenance,
  verifyTrack,
} from '../server/admin';

// --- output helpers ---------------------------------------------------------

function ok(message: string) {
  console.log(`  \x1b[92m✓\x1b[0m ${message}`);
}
function warn(message: string) {
  console.log(`  \x1b[93m!\x1b[0m ${message}`);
}
function err(message: string) {
  console.log(`  \x1b[31m✗\x1b[0m ${message}`);
}
function line() {
  console.log('  ' + '-'.repeat(56));
}

// --- env file helpers -------------------------------------------------------

async function prompt(rl: readline.Interface, question: string, fallback?: string): Promise<string> {
  const q = fallback ? `${question} [${fallback}] ` : `${question} `;
  const answer = (await rl.question(q)).trim();
  return answer || fallback || '';
}

// --- status -----------------------------------------------------------------

function cmdStatus() {
  const stats = getAdminStats();
  const o = stats.overview;
  const db = getDb();
  const owner = db
    .prepare("SELECT username, totp_enabled FROM users WHERE role = 'owner' ORDER BY id ASC LIMIT 1")
    .get() as { username: string; totp_enabled: number } | undefined;
  const missingMeta = db
    .prepare("SELECT COUNT(*) AS n FROM tracks WHERE codec IS NULL OR sample_rate IS NULL OR sample_rate = 0")
    .get() as { n: number };

  console.log('\n  \x1b[1mOpen Audio — server status\x1b[0m\n');
  line();
  console.log('  Config');
  line();
  console.log(`    database   ${config.databasePath}`);
  console.log(`    uploads    ${config.uploadDir}`);
  console.log(`    app url    ${config.appUrl}`);
  console.log(`    mode       ${config.isProduction ? 'production' : 'development'}`);
  console.log(`    cookies    ${config.cookieSecure ? 'secure' : 'non-secure'}`);
    console.log(`    csp        ${config.enableCsp ? 'enabled' : 'disabled'}`);
    console.log(
      config.removalKey
        ? '    removal key configured'
        : '    removal key NOT set — run `npm run admin removal-key`',
    );
  line();
  console.log('  Owner');
  line();
  if (owner) {
    console.log(`    account    ${owner.username}`);
    console.log(`    2FA        ${owner.totp_enabled ? 'enabled' : 'disabled'}`);
  } else {
    warn('no owner account — run `npm run setup` (or `npm run admin account owner`) to create one');
  }
  line();
  console.log('  Tracks');
  line();
  console.log(`    total      ${o.totalTracks}`);
  console.log(`    pending    ${o.pendingTracks}`);
  console.log(`    verified   ${o.verifiedTracks}`);
  console.log(`    suspended  ${o.suspendedTracks}`);
  console.log(`    rejected   ${o.rejectedTracks}`);
  console.log(
    `    no meta    ${missingMeta.n} (run \`npm run admin scan\` to backfill)`,
  );
  console.log(`    plays      ${o.totalPlays}   likes ${o.totalLikes}`);
  line();
  console.log('  Users');
  line();
  console.log(`    total      ${o.totalUsers}`);
  console.log(`    banned     ${o.bannedUsers}`);
  line();
  console.log('  System');
  line();
  console.log(`    audit log  ${stats.auditEntries} entries`);
  console.log(`    db size    ${formatBytes(stats.dbBytes)}`);

  if (stats.topTracks.length > 0) {
    line();
    console.log('  Top tracks');
    line();
    for (const t of stats.topTracks) {
      console.log(`    #${t.id}  ${t.title} — ${t.artist}   ${t.plays} plays`);
    }
  }

  if (config.jwtSecret === 'insecure-dev-secret-change-me' || config.jwtSecret.length < 16) {
    warn('JWT_SECRET is weak — run `npm run admin secret`');
  }
  if (!config.isProduction && config.cookieSecure) {
    warn('COOKIE_SECURE=1 with a non-https APP_URL may block logins in development');
  }
}

// --- secret -----------------------------------------------------------------

function cmdSecret() {
  const vars = readEnv();
  const current = vars.JWT_SECRET || config.jwtSecret;
  if (current === 'insecure-dev-secret-change-me') {
    warn('current secret is the insecure default');
  }
  vars.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  writeEnv(vars);
  ok('JWT_SECRET rotated and written to .env');
  warn('all existing sessions will be invalidated — users must log in again');
  warn('users with 2FA enabled will need to re-enable it (secrets are encrypted with the old key)');
}

// --- removal key ------------------------------------------------------------

function cmdRemovalKey() {
  const vars = readEnv();
  const key = crypto.randomBytes(24).toString('base64url');
  vars.REMOVAL_KEY = key;
  writeEnv(vars);
  ok('REMOVAL_KEY generated and written to .env');
  warn('this key lets the CLI request a full server removal');
  warn('the owner must enter the same key in the admin panel (Danger zone) to confirm');
  console.log(`\n    removal key:  ${key}\n`);
}

async function cmdRemoveServer(args: string[]) {
  const vars = readEnv();
  const explicit = args.find((a) => a.startsWith('--key='))?.slice('--key='.length) ?? '';
  const key = explicit || vars.REMOVAL_KEY || config.removalKey || '';
  if (!key) throw new AppError(400, 'REMOVAL_KEY is not set — run `npm run admin removal-key` first');
  const reason = args.filter((a) => !a.startsWith('--')).join(' ').trim();

  const url = `${config.appUrl.replace(/\/$/, '')}/api/admin/removal-request`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, reason }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    throw new AppError(res.status, typeof data.error === 'string' ? data.error : `request failed (${res.status})`);
  }
  ok(`removal request #${data.request.id} sent to ${config.appUrl}`);
  ok('the owner must confirm it from the admin panel → Danger zone, entering the same removal key');
  warn('confirming the request permanently deletes the database, uploads, build and .env');
}

// --- account ----------------------------------------------------------------

async function cmdAccount(args: string[]) {
  const [type, ...rest] = args;
  if (!type) throw new AppError(400, 'usage: admin account <owner|admin> [username]');
  if (type === 'owner') return cmdOwner(rest);
  if (type === 'admin') return cmdAdmin(rest);
  throw new AppError(400, `unknown account type "${type}" — use "owner" or "admin"`);
}

async function cmdAdmin(args: string[]) {
  const vars = readEnv();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const username = args[0] || vars.ADMIN_USERNAME || (await prompt(rl, 'Admin username:', 'admin'));
  const password = vars.ADMIN_PASSWORD || (await prompt(rl, 'Admin password (min 8 chars):', randomPassword()));
  rl.close();
  if (password.length < 8) throw new AppError(400, 'password must be at least 8 characters');
  const created = upsertAdmin(getDb(), { username, password, email: vars.ADMIN_EMAIL });
  ok(created ? `admin "${username}" created` : `admin "${username}" updated`);
}

// --- owner account ----------------------------------------------------------

async function cmdOwner(args: string[]) {
  const vars = readEnv();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const username = args[0] || vars.OWNER_USERNAME || vars.ADMIN_USERNAME || (await prompt(rl, 'Owner username:', 'owner'));
  const password =
    vars.OWNER_PASSWORD || vars.ADMIN_PASSWORD || (await prompt(rl, 'Owner password (min 8 chars):', randomPassword()));
  rl.close();
  if (password.length < 8) throw new AppError(400, 'password must be at least 8 characters');
  const created = upsertOwner(getDb(), { username, password, email: vars.OWNER_EMAIL || vars.ADMIN_EMAIL });
  ok(created ? `owner "${username}" created` : `owner "${username}" updated`);
}

// --- scan -------------------------------------------------------------------

async function cmdScan(args: string[]) {
  const all = args.includes('--all');
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, artist, audio_url FROM tracks ${
        all ? '' : 'WHERE codec IS NULL OR sample_rate IS NULL OR sample_rate = 0'
      } ORDER BY id`,
    )
    .all() as { id: number; title: string; artist: string; audio_url: string }[];

  if (rows.length === 0) {
    ok('no tracks to scan');
    return;
  }

  line();
  console.log(`  Scanning ${rows.length} track(s)…`);
  line();

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const update = db.prepare(
    'UPDATE tracks SET sample_rate = ?, bit_depth = ?, bitrate = ?, duration = ?, codec = ?, container = ?, lossless = ? WHERE id = ?',
  );
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const abs = resolveInside(config.uploadDir, String(row.audio_url).replace(/^\/uploads\//, ''));
      if (!abs || !fs.existsSync(abs)) {
        skipped += 1;
        console.log(`    #${row.id}  ${row.title} — ${row.artist}   file missing`);
        continue;
      }
      try {
        const meta = await readAudioMeta(abs);
        if (!meta) {
          failed += 1;
          console.log(`    #${row.id}  ${row.title} — ${row.artist}   unreadable`);
          continue;
        }
        update.run(
          meta.sampleRate,
          meta.bitsPerSample,
          meta.bitrate,
          meta.duration,
          meta.codec,
          meta.container,
          meta.lossless ? 1 : 0,
          row.id,
        );
        updated += 1;
        console.log(
          `    #${row.id}  ${row.title} — ${row.artist}   ${formatQuality({
            sample_rate: meta.sampleRate,
            bit_depth: meta.bitsPerSample,
            bitrate: meta.bitrate,
          })}`,
        );
      } catch {
        failed += 1;
        console.log(`    #${row.id}  ${row.title} — ${row.artist}   unreadable`);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  auditLog({ action: 'track.scan', detail: `${updated} updated, ${skipped} skipped, ${failed} failed` });
  ok(`${updated} updated, ${skipped} skipped, ${failed} failed`);
}

// --- user -------------------------------------------------------------------

async function cmdUser(args: string[]) {
  const [identifier, action, ...rest] = args;
  if (!identifier)
    throw new AppError(400, 'usage: admin user <id|username> [ban|unban|promote|demote|supporter [on|off]|password <pw>]');

  if (!action) {
    const { user, counts } = getUserSummary(identifier);
    line();
    console.log('  User');
    line();
    console.log(`    id        ${user.id}`);
    console.log(`    username  ${user.username}`);
    console.log(`    email     ${user.email ?? '-'}`);
    console.log(`    role      ${user.role}`);
    console.log(`    supporter ${user.supporter ? 'yes' : 'no'}`);
    console.log(`    banned    ${user.banned ? 'yes' : 'no'}`);
    console.log(`    bio       ${user.bio ? user.bio.slice(0, 60) : '-'}`);
    console.log(`    created   ${formatDate(Number(user.created_at))}`);
    console.log(`    last seen ${user.last_seen ? formatDate(Number(user.last_seen)) : '-'}`);
    line();
    console.log('  Activity');
    line();
    console.log(`    tracks     ${counts.tracks}`);
    console.log(`    plays      ${counts.plays}`);
    console.log(`    likes      ${counts.likes}`);
    console.log(`    following  ${counts.following}`);
    console.log(`    followers  ${counts.followers}`);
    return;
  }

  switch (action) {
    case 'ban': {
      const user = setUserBanned(identifier, true, null);
      ok(`user "${user.username}" banned`);
      break;
    }
    case 'unban': {
      const user = setUserBanned(identifier, false, null);
      ok(`user "${user.username}" unbanned`);
      break;
    }
    case 'promote': {
      const user = setUserRole(identifier, 'admin', null);
      ok(`user "${user.username}" is now admin`);
      break;
    }
    case 'demote': {
      const user = setUserRole(identifier, 'user', null);
      ok(`user "${user.username}" is now a regular user`);
      break;
    }
    case 'supporter': {
      const value = rest[0];
      let enabled: boolean;
      if (!value) {
        const current = Boolean(getUserSummary(identifier).user.supporter);
        enabled = !current;
      } else if (value === 'on' || value === '1' || value === 'true') {
        enabled = true;
      } else if (value === 'off' || value === '0' || value === 'false') {
        enabled = false;
      } else {
        throw new AppError(400, 'usage: admin user <id> supporter [on|off]');
      }
      const user = setUserSupporter(identifier, enabled, null);
      ok(`supporter badge ${enabled ? 'granted to' : 'revoked from'} "${user.username}"`);
      break;
    }
    case 'password': {
      let pw = rest[0];
      if (!pw) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        pw = await prompt(rl, 'New password (min 8 chars):');
        rl.close();
      }
      const user = resetUserPassword(identifier, pw, null);
      ok(`password reset for "${user.username}"`);
      break;
    }
    default:
      throw new AppError(400, `unknown user action "${action}"`);
  }
}

// --- track ------------------------------------------------------------------

function cmdTrack(args: string[]) {
  const [idStr, action, ...rest] = args;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'usage: admin track <id> [verify|suspend|unsuspend|reject <reason>|delete|resubmit]');

  if (!action) {
    const { track, fanCount } = getTrackSummary(id);
    line();
    console.log('  Track');
    line();
    console.log(`    id          ${track.id}`);
    console.log(`    title       ${track.title}`);
    console.log(`    artist      ${track.artist}`);
    console.log(`    status      ${track.status}${track.status === 'rejected' && track.rejection_reason ? ` (${track.rejection_reason})` : ''}`);
    console.log(`    uploader    ${track.uploader_username ?? 'unknown'} (id ${track.uploader_id ?? '-'})`);
    console.log(`    duration    ${track.duration}s`);
    console.log(`    quality     ${formatQuality(track)}`);
    console.log(`    category    ${qualityTierLabel(qualityTier(track))}${track.codec ? `  (${track.codec}${track.container ? ` · ${track.container}` : ''})` : ''}`);
    console.log(`    plays       ${track.plays}   likes ${track.likes}   reposts ${track.reposts}`);
    console.log(`    fans        ${fanCount}`);
    console.log(`    created     ${formatDate(Number(track.created_at))}`);
    console.log(`    audio       ${track.audio_url}`);
    if (track.cover_url) console.log(`    cover       ${track.cover_url}`);
    return;
  }

  let track;
  switch (action) {
    case 'verify':
      track = verifyTrack(id, null);
      ok(`track "${track.title}" verified`);
      break;
    case 'suspend':
      track = suspendTrack(id, null);
      ok(`track "${track.title}" suspended`);
      break;
    case 'unsuspend':
      track = unsuspendTrack(id, null);
      ok(`track "${track.title}" unsuspended`);
      break;
    case 'reject': {
      const reason = rest.join(' ').trim();
      if (!reason) throw new AppError(400, 'a rejection reason is required');
      track = rejectTrack(id, reason, null);
      ok(`track "${track.title}" rejected: ${reason}`);
      break;
    }
    case 'delete':
      track = deleteTrack(id, null);
      ok(`track "${track.title}" deleted`);
      break;
    case 'resubmit':
      track = resubmitTrack(id, null);
      ok(`track "${track.title}" resubmitted for moderation`);
      break;
    default:
      throw new AppError(400, `unknown track action "${action}"`);
  }
  void track;
}

// --- backups / maintenance --------------------------------------------------

function cmdBackup(args: string[]) {
  const result = backupDatabase(args[0]);
  ok(`backup created in ${result.dir}`);
  ok(`  snapshot ${result.snapshotPath} (${formatBytes(fs.statSync(result.snapshotPath).size)})`);
  ok(`  ${result.uploadsCopied} upload file(s) copied`);
}

function cmdRestore(args: string[]) {
  const sourceDir = args.find((a) => !a.startsWith('--'));
  const force = args.includes('--force');
  if (!sourceDir) throw new AppError(400, 'usage: admin restore <backup-dir> [--force]');
  const result = restoreDatabase(sourceDir, { force });
  ok(`restored from ${result.restored}`);
}

function cmdVacuum() {
  const result = vacuumMaintenance();
  if (result.integrity !== 'ok') {
    warn(`integrity check: ${result.integrity}`);
  } else {
    ok(`integrity check passed`);
  }
  ok(`pages ${result.pagesBefore} -> ${result.pagesAfter}`);
  ok('VACUUM complete');
}

function cmdPrune(args: string[]) {
  const dryRun = !args.includes('--delete');
  const result = pruneOrphans(!dryRun);
  if (result.orphans.length === 0) {
    ok('no orphaned files found');
    return;
  }
  const totalBytes = result.orphans.reduce((sum, f) => sum + f.bytes, 0);
  for (const orphan of result.orphans) {
    console.log(`    ${orphan.file}  (${formatBytes(orphan.bytes)})`);
  }
  ok(`${result.orphans.length} orphaned file(s), ${formatBytes(totalBytes)} ${dryRun ? 'would be removed' : 'removed'}`);
  if (dryRun) warn('re-run with --delete to remove them');
}

function cmdNotify(args: string[]) {
  const [identifier, ...rest] = args;
  const message = rest.join(' ').trim();
  if (!identifier || !message) throw new AppError(400, 'usage: admin notify <user-id|username> <message>');
  const user = notifyUser(identifier, message, null);
  ok(`notification sent to "${user.username}"`);
}

// --- inactive-account purge -------------------------------------------------

const DEFAULT_PURGE_MONTHS = 19;

function cmdPurgeInactive(args: string[]) {
  const monthsArg = args.find((a) => !a.startsWith('--'));
  const months = monthsArg !== undefined ? Number(monthsArg) : DEFAULT_PURGE_MONTHS;
  const performDelete = args.includes('--delete');
  const includeAdmins = args.includes('--include-admins');
  const includeSupporters = args.includes('--include-supporters');
  if (!Number.isFinite(months) || months <= 0) {
    throw new AppError(400, 'months must be a positive number');
  }

  const result = purgeInactiveAccounts({ months, performDelete, includeAdmins, includeSupporters });

  line();
  console.log(`  Inactive accounts — no activity since ${formatDate(result.cutoff)} (> ${months} months)`);
  line();
  if (result.backfilled > 0) {
    console.log(`  (backfilled last-activity for ${result.backfilled} legacy account(s))`);
  }
  if (result.candidates.length === 0) {
    ok('no inactive accounts found');
    return;
  }
  for (const c of result.candidates) {
    console.log(
      `    #${c.id}  ${c.username.padEnd(20)} role ${c.role.padEnd(5)} tracks ${String(c.trackCount).padStart(3)}   last seen ${c.lastSeen ? formatDate(c.lastSeen) : '-'}`,
    );
  }
  ok(`${result.candidates.length} account(s) ${performDelete ? 'deleted' : 'would be deleted'}`);
  if (!performDelete) {
    warn('re-run with --delete to remove them');
    if (!includeAdmins) warn('admins are excluded — pass --include-admins to include them');
    if (!includeSupporters) warn('supporters are excluded — pass --include-supporters to include them');
  }
}

const TRACK_STATUSES = ['pending', 'verified', 'suspended', 'rejected', 'all'];

function cmdListTracks(args: string[]) {
  const status = (args[0] ?? 'pending').toLowerCase();
  if (!TRACK_STATUSES.includes(status)) {
    throw new AppError(400, `unknown track status "${status}" — use ${TRACK_STATUSES.join('|')}`);
  }
  const rows = listTracksForModeration(status);
  if (rows.length === 0) {
    ok(status === 'pending' ? 'no tracks awaiting moderation' : `no ${status} tracks`);
    return;
  }
  line();
  console.log(`  Tracks — ${status}`);
  line();
  for (const r of rows) {
    console.log(`    #${r.id}  ${r.title} — ${r.artist}  (uploaded by ${r.uploader_username ?? 'unknown'})`);
  }
  ok(`${rows.length} ${status} track(s) — try \`admin track <id>\``);
}

function userFlag(u: Record<string, any>): string {
  if (u.role === 'owner') return 'owner';
  if (u.role === 'admin') return 'admin';
  return !!u.banned ? 'banned' : '';
}

function cmdListUsers() {
  const users = listUsers();
  line();
  console.log('  Users');
  line();
  for (const u of users) {
    console.log(`    #${u.id}  ${u.username.padEnd(20)} tracks ${String(u.track_count).padStart(3)}   ${userFlag(u)}`);
  }
}

// --- help -------------------------------------------------------------------

function cmdHelp() {
  console.log(`
  \x1b[1mOpen Audio — admin CLI\x1b[0m

  Usage:
    npm run admin <entity> [id] <action> [args]

  Accounts
    account owner [username]        create or reset the owner account
    account admin [username]        create or reset an admin account
    secret                          rotate JWT_SECRET in .env

  Users
    users                           list users
    user <id|username>              show a user
    user <id> ban|unban             ban / unban a user
    user <id> promote|demote        change a user's role (owner cannot be changed here)
    user <id> supporter [on|off]    grant / revoke the supporter badge (unlocks FLAC downloads)
    user <id> password [pw]         reset a user's password (prompts if omitted)

  Tracks
    tracks [status]                 list tracks by status: pending|verified|suspended|rejected|all (default: pending)
    track <id>                      show a track (incl. quality)
    track <id> verify               publish a track
    track <id> suspend|unsuspend    toggle playback
    track <id> reject <reason>      reject with a reason
    track <id> resubmit             send a rejected track back to pending
    track <id> delete               permanently delete a track

  Maintenance
    scan [--all]                    backfill sample rate / bit depth / bitrate / codec for tracks
    backup [dir]                    snapshot database + uploads to a folder
    restore <backup-dir> --force    restore a backup folder
    vacuum                          integrity check + VACUUM
    prune [--delete]                report (or remove) orphaned upload files
    purge-inactive [months]         list accounts inactive for > months (default: 19)
    purge-inactive <months> --delete
                                    permanently delete them (owner/admins/supporters are protected)
    notify <id|username> <message>  send a manual notification

  Server
    status                          show server + moderation overview
    removal-key                     generate / rotate REMOVAL_KEY in .env
    remove-server [reason]          request a full server removal (owner confirms in the panel)

  Older spellings \`owner\`, \`admin\`, \`pending\` still work as aliases.
`);
}

// --- main -------------------------------------------------------------------

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    cmdHelp();
    return;
  }

  try {
    switch (cmd) {
      case 'status':
        cmdStatus();
        break;
      case 'secret':
        cmdSecret();
        break;
      case 'account':
        await cmdAccount(args);
        break;
      case 'admin':
        await cmdAdmin(args);
        break;
      case 'owner':
        await cmdOwner(args);
        break;
      case 'scan':
        await cmdScan(args);
        break;
      case 'user':
        await cmdUser(args);
        break;
      case 'track':
        cmdTrack(args);
        break;
      case 'tracks':
        cmdListTracks(args);
        break;
      case 'pending':
        cmdListTracks([]);
        break;
      case 'backup':
        cmdBackup(args);
        break;
      case 'restore':
        cmdRestore(args);
        break;
      case 'vacuum':
        cmdVacuum();
        break;
      case 'prune':
        cmdPrune(args);
        break;
      case 'purge-inactive':
        cmdPurgeInactive(args);
        break;
      case 'notify':
        cmdNotify(args);
        break;
      case 'users':
        cmdListUsers();
        break;
      case 'removal-key':
        cmdRemovalKey();
        break;
      case 'remove-server':
        await cmdRemoveServer(args);
        break;
      default:
        err(`unknown command "${cmd}"`);
        cmdHelp();
        process.exitCode = 1;
    }
  } catch (e) {
    if (e instanceof AppError) {
      err(e.message);
      process.exitCode = 1;
    } else {
      console.error(e);
      process.exitCode = 1;
    }
  } finally {
    closeDb();
  }
}

main();
