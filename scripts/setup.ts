import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import QRCode from 'qrcode';
import { getDb, closeDb } from '../server/db';
import { upsertOwner } from '../server/seed';
import { auditLog } from '../server/audit';
import {
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  provisioningUri,
  verifyTotp,
} from '../server/totp';
import { root, parseEnv, renderEnv, randomPassword } from './env';

const REQUIRED_NODE = [24, 0, 0];
const LEGACY_MIN = [22, 5, 0];

function versionAtLeast(v: string, min: number[]): boolean {
  const parts = v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < min.length; i++) {
    const a = parts[i] ?? 0;
    if (a > min[i]) return true;
    if (a < min[i]) return false;
  }
  return true;
}

function log(step: string, message: string) {
  console.log(`  \x1b[90m·\x1b[0m ${step} \x1b[90m${message}\x1b[0m`);
}
function ok(message: string) {
  console.log(`  \x1b[92m✓\x1b[0m ${message}`);
}
function warn(message: string) {
  console.log(`  \x1b[93m!\x1b[0m ${message}`);
}
function done(message: string) {
  console.log(`  \x1b[92m✔\x1b[0m ${message}`);
}

let rl: readline.Interface | null = null;
function getRl(): readline.Interface {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}
const interactive = Boolean(process.stdin.isTTY);

async function prompt(question: string, fallback?: string): Promise<string> {
  const q = fallback ? `${question} [${fallback}] ` : `${question} `;
  const answer = (await getRl().question(q)).trim();
  return answer || fallback || '';
}

function validateUsername(username: string): string | null {
  if (username.length < 3 || username.length > 24) return 'must be 3-24 characters';
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) return 'may contain only letters, numbers, . _ -';
  return null;
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'must be at least 8 characters';
  return null;
}

async function resolveUsername(envUsername: string): Promise<string> {
  if (envUsername) {
    const err = validateUsername(envUsername);
    if (err) throw new Error(`OWNER_USERNAME is invalid (${err})`);
    return envUsername;
  }
  if (!interactive) return 'owner';
  while (true) {
    const answer = await prompt('Owner username (3-24 chars, letters/numbers/._-):', 'owner');
    const err = validateUsername(answer);
    if (err) {
      warn(`username ${err} — try again`);
      continue;
    }
    return answer;
  }
}

// Returns { password, keepCurrent }. When keepCurrent is true the existing
// account password is left untouched (no silent reset on re-run).
async function resolvePassword(existing: boolean, envPassword: string): Promise<{ password: string; keepCurrent: boolean }> {
  if (envPassword) {
    const err = validatePassword(envPassword);
    if (err) throw new Error(`OWNER_PASSWORD is invalid (${err})`);
    return { password: envPassword, keepCurrent: false };
  }
  if (interactive && existing) {
    const answer = await prompt('Owner password (empty keeps the current one, min 8 chars):');
    if (answer) {
      const err = validatePassword(answer);
      if (err) throw new Error(`password ${err}`);
      return { password: answer, keepCurrent: false };
    }
    return { password: '', keepCurrent: true };
  }
  if (interactive) {
    while (true) {
      const first = await prompt('Owner password (min 8 chars):');
      if (!first) {
        warn('password cannot be empty — try again');
        continue;
      }
      const err = validatePassword(first);
      if (err) {
        warn(`password ${err} — try again`);
        continue;
      }
      const second = await prompt('Repeat owner password:');
      if (second !== first) {
        warn('passwords do not match — try again');
        continue;
      }
      return { password: first, keepCurrent: false };
    }
  }
  if (existing) return { password: '', keepCurrent: true };
  return { password: randomPassword(), keepCurrent: false };
}

async function enrollOwner2fa(userId: number, username: string, db: ReturnType<typeof getDb>): Promise<boolean> {
  if (!interactive) return false;
  const answer = await prompt('Enable two-factor authentication for the owner now?', 'y/N');
  if (!/^y(es)?$/i.test(answer)) return false;

  const secret = generateSecret();
  const recoveryCodes = generateRecoveryCodes();
  const uri = provisioningUri(secret, username);
  const qr = await QRCode.toString(uri, { type: 'terminal', small: true });

  console.log(`\n${qr}`);
  console.log(`  Scan the QR code with your authenticator app, or add this account manually:\n`);
  console.log(`    account      ${username}`);
  console.log(`    secret key   ${secret}\n`);
  console.log('  Store these recovery codes somewhere safe — they are shown only once:\n');
  for (const rc of recoveryCodes) console.log(`    ${rc}`);

  while (true) {
    const code = await prompt('\nEnter the 6-digit code from your authenticator to confirm:');
    if (!code) continue;
    if (!verifyTotp(secret, code)) {
      warn('invalid code — check that your authenticator is in sync and try again');
      continue;
    }
    break;
  }

  db.prepare(
    'UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_recovery = ?, totp_confirmed_at = ? WHERE id = ?',
  ).run(encryptSecret(secret), JSON.stringify(recoveryCodes.map((rc) => hashRecoveryCode(rc))), Date.now(), userId);

  auditLog({ action: '2fa.enable', targetType: 'user', targetId: userId, detail: 'owner enrolled during setup' });
  return true;
}

function checkNode() {
  if (!versionAtLeast(process.version, LEGACY_MIN)) {
    console.error(`\x1b[31mOpen Audio requires Node.js >= 22.5 (found ${process.version}). node:sqlite is unavailable.\x1b[0m`);
    process.exit(1);
  }
  if (versionAtLeast(process.version, REQUIRED_NODE)) {
    ok(`Node.js ${process.version} (node:sqlite stable)`);
  } else {
    warn(`Node.js ${process.version}: node:sqlite is experimental — recommend Node 24+`);
  }
}

async function ensureDependencies() {
  if (!fs.existsSync(path.join(root, 'node_modules'))) {
    log('npm', 'installing dependencies…');
    const { execSync } = await import('node:child_process');
    execSync('npm install', { cwd: root, stdio: 'inherit' });
    ok('dependencies installed');
  } else {
    ok('dependencies present');
  }
}

// Keys that may be supplied via the real environment (container orchestrators,
// CI, `docker run -e`). When present they win over any persisted .env so that
// secrets stay consistent across replicas instead of each pod minting its own.
const ENV_OVERRIDES = [
  'NODE_ENV',
  'PORT',
  'DATABASE_PATH',
  'UPLOAD_DIR',
  'JWT_SECRET',
  'REMOVAL_KEY',
  'APP_URL',
  'COOKIE_SECURE',
  'TRUST_PROXY',
  'HELMET_CSP',
  'OWNER_USERNAME',
  'OWNER_PASSWORD',
  'OWNER_EMAIL',
  'RATE_LIMIT_WINDOW',
  'RATE_LIMIT_API_MAX',
  'RATE_LIMIT_AUTH_MAX',
  'YTDLP_PATH',
  'YTDLP_TIMEOUT_S',
];

function setupEnv(): { vars: Record<string, string>; removalKey: string } {
  const envPath = path.join(root, '.env');
  const examplePath = path.join(root, '.env.example');
  const example = fs.existsSync(examplePath) ? parseEnv(fs.readFileSync(examplePath, 'utf8')) : {};
  const vars: Record<string, string> = { ...example };

  if (fs.existsSync(envPath)) {
    Object.assign(vars, parseEnv(fs.readFileSync(envPath, 'utf8')));
    log('.env', 'existing file loaded');
  } else {
    fs.writeFileSync(envPath, renderEnv(vars), 'utf8');
    log('.env', 'created from .env.example');
  }

  // Real environment overrides win last so orchestrator-provided secrets win.
  let envOverridesApplied = 0;
  for (const key of ENV_OVERRIDES) {
    if (process.env[key]) {
      vars[key] = process.env[key] as string;
      envOverridesApplied += 1;
    }
  }
  if (envOverridesApplied > 0) {
    fs.writeFileSync(envPath, renderEnv(vars), 'utf8');
    log('.env', `${envOverridesApplied} value(s) taken from environment`);
  }

  if (!vars.JWT_SECRET || vars.JWT_SECRET === 'change-me' || vars.JWT_SECRET.length < 16) {
    vars.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(envPath, renderEnv(vars), 'utf8');
    ok('JWT_SECRET generated');
  }

  let removalKey = vars.REMOVAL_KEY;
  if (!removalKey) {
    removalKey = crypto.randomBytes(24).toString('base64url');
    vars.REMOVAL_KEY = removalKey;
    fs.writeFileSync(envPath, renderEnv(vars), 'utf8');
    ok('REMOVAL_KEY generated (verified server-removal flow)');
  }
  return { vars, removalKey };
}

function setupDirectories(vars: Record<string, string>): string {
  const dbPath = path.resolve(root, vars.DATABASE_PATH || './data/open-audio.db');
  const uploadDir = path.resolve(root, vars.UPLOAD_DIR || './uploads');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.join(uploadDir, 'audio'), { recursive: true });
  fs.mkdirSync(path.join(uploadDir, 'covers'), { recursive: true });
  ok('data + uploads directories ready');
  return dbPath;
}

async function setupOwner(db: ReturnType<typeof getDb>, vars: Record<string, string>) {
  const envUsername = vars.OWNER_USERNAME || vars.ADMIN_USERNAME || '';
  const envPassword = vars.OWNER_PASSWORD || vars.ADMIN_PASSWORD || '';
  const envEmail = vars.OWNER_EMAIL || vars.ADMIN_EMAIL || '';

  const username = await resolveUsername(envUsername);
  const existing = db
    .prepare('SELECT id FROM users WHERE lower(username) = lower(?)')
    .get(username.toLowerCase()) as { id: number } | undefined;

  const { password, keepCurrent } = await resolvePassword(Boolean(existing), envPassword);

  const created = upsertOwner(db, {
    username,
    password: keepCurrent ? undefined : password,
    email: envEmail || undefined,
  });

  if (created) {
    done(`owner "${username}" created`);
  } else {
    done(keepCurrent ? `owner "${username}" exists — password kept unchanged` : `owner "${username}" updated`);
  }
  return { username, password, keepCurrent, existing: Boolean(existing) };
}

async function setupOwner2fa(db: ReturnType<typeof getDb>, username: string): Promise<boolean> {
  const ownerRow = db
    .prepare('SELECT id, totp_enabled FROM users WHERE lower(username) = lower(?)')
    .get(username.toLowerCase()) as { id: number; totp_enabled: number };
  if (!ownerRow.totp_enabled) {
    const enabled = await enrollOwner2fa(Number(ownerRow.id), username, db);
    if (enabled) ok('two-factor authentication enabled for the owner');
  }
  return ownerRow.totp_enabled === 1;
}

async function main() {
  console.log('\n\x1b[1mOpen Audio — setup\x1b[0m\n');

  checkNode();
  await ensureDependencies();

  const { vars, removalKey } = setupEnv();
  const dbPath = setupDirectories(vars);

  const db = getDb();
  ok(`database ready at ${path.relative(root, dbPath)}`);

  const { username, password, keepCurrent, existing } = await setupOwner(db, vars);
  const ownerHas2fa = await setupOwner2fa(db, username);

  if (rl) rl.close();
  closeDb();

  console.log('\n\x1b[1mSetup complete.\x1b[0m');
  console.log('\n  Run:');
  console.log('    npm run dev     # frontend :3000 + api :4000');
  console.log('    npm run build && npm start   # production build\n');
  console.log('  Owner login:');
  console.log(`    username  ${username}`);
  if (password) console.log(`    password  ${password}`);
  if (keepCurrent) console.log('    password  (kept the existing one)');
  if (!password && !keepCurrent) console.log('    password  (unchanged — set one via `npm run admin account owner`)');
  console.log('');
  if (ownerHas2fa || (existing && !interactive)) {
    console.log('  Note: the owner account has two-factor authentication enabled.\n');
  }
  if (removalKey) {
    console.log('  Server removal key (keep private — the owner needs it to confirm removal):');
    console.log(`    ${removalKey}\n`);
  }
  console.log('  Tip: set OWNER_USERNAME / OWNER_PASSWORD in .env and re-run `npm run setup` to rotate them.\n');
}

main().catch((err) => {
  console.error(err);
  if (rl) rl.close();
  closeDb();
  process.exit(1);
});
