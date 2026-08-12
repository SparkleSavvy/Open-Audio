import { Request, Response, Router } from 'express';
import QRCode from 'qrcode';
import { getDb } from '../db';
import { hashPassword, signChallengeToken, signToken, verifyChallengeToken, verifyPassword } from '../auth';
import { requireAuth } from '../middleware';
import { toUser } from '../serialize';
import { config } from '../config';
import { bruteForceGuard, clearLoginFailures, rateLimit, registerLoginFailure } from '../security';
import { auditLog } from '../audit';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  isRecoveryCodeFormat,
  matchRecoveryCode,
  provisioningUri,
  verifyTotp,
} from '../totp';

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.cookieSecure,
  maxAge: 7 * 24 * 3600 * 1000,
  path: '/',
  priority: 'high' as const,
};

// Sent only to the 2FA endpoint, five-minute lifespan, proves the password step.
const CHALLENGE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.cookieSecure,
  maxAge: 5 * 60 * 1000,
  path: '/api/auth/login/2fa',
  priority: 'high' as const,
};

function setToken(res: Response, userId: number, role: string) {
  res.cookie('token', signToken({ userId, role }), COOKIE_OPTIONS);
}

function setChallenge(res: Response, userId: number) {
  res.cookie('2fa_challenge', signChallengeToken(userId), CHALLENGE_COOKIE_OPTIONS);
}

function clearChallenge(res: Response) {
  res.clearCookie('2fa_challenge', { path: '/api/auth/login/2fa' });
}

const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  message: 'Too many attempts, please slow down',
});

function loginKey(req: Request): string {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  return `${username}|${req.ip ?? 'unknown'}`;
}

function twoFaKey(req: Request): string {
  const userId = Number(req.body?.userId);
  return `${Number.isInteger(userId) ? userId : '?'}|${req.ip ?? 'unknown'}`;
}

function failAttempt(res: Response, key: string, message: string, extraKey?: string) {
  const remaining = registerLoginFailure(key);
  if (extraKey) registerLoginFailure(extraKey);
  if (remaining > 0) {
    res.setHeader('Retry-After', String(Math.ceil(remaining / 1000)));
  }
  return res.status(401).json({ error: message });
}

function handleRegister(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (username.length < 3 || username.length > 24) {
    return res.status(400).json({ error: 'Username must be 3-24 characters' });
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username may contain letters, numbers, . _ -' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM users WHERE lower(username) = lower(?) OR (email IS NOT NULL AND lower(email) = lower(?))')
    .get(username, email) as { id: number } | undefined;
  if (existing) {
    return res.status(409).json({ error: 'Registration failed' });
  }

  // Check-then-insert is not atomic; two simultaneous registrations with the
  // same username/email both pass the existence check above. Map the resulting
  // UNIQUE violation back to the intended 409 instead of a 500.
  let rowId: number | bigint;
  try {
    rowId = db
      .prepare('INSERT INTO users (username, email, password_hash, role, created_at, last_seen) VALUES (?,?,?,?,?,?)')
      .run(username, email || null, hashPassword(password), 'user', Date.now(), Date.now()).lastInsertRowid;
  } catch (e) {
    if (String((e as Error).message).includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Registration failed' });
    }
    throw e;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(rowId)) as Record<string, any>;
  setToken(res, user.id, user.role);
  return res.status(201).json({ user: toUser(user) });
}

router.post('/register', authLimiter, handleRegister);

function handleLogin(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const db = getDb();
  const user = db
    .prepare('SELECT * FROM users WHERE lower(username) = lower(?)')
    .get(username.toLowerCase()) as Record<string, any> | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) {
    return failAttempt(res, loginKey(req), 'Invalid username or password', req.ip ?? 'unknown');
  }
  if (user.banned) {
    return res.status(403).json({ error: 'Account suspended' });
  }

  clearLoginFailures(loginKey(req));
  clearLoginFailures(req.ip ?? 'unknown');

  if (user.totp_enabled) {
    setChallenge(res, user.id);
    return res.json({ need2fa: true, userId: user.id, username: user.username });
  }

  setToken(res, user.id, user.role);
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), user.id);
  return res.json({ user: toUser(user) });
}

router.post('/login', authLimiter, bruteForceGuard(loginKey), handleLogin);

function loadRecoveryHashes(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : [];
  } catch {
    return [];
  }
}

// Second login step: verify a TOTP code (or a single-use recovery code).
function handleTwoFaLogin(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const userId = Number(body.userId);
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!Number.isInteger(userId) || userId <= 0 || !code) {
    return res.status(400).json({ error: 'Verification code is required' });
  }

  // A short-lived cookie is only issued after a successful password check.
  // Without it the 2FA endpoint cannot be used to skip the password step.
  const challenge = req.cookies?.['2fa_challenge'];
  if (!challenge || typeof challenge !== 'string' || verifyChallengeToken(challenge) !== userId) {
    return res.status(401).json({ error: 'Sign in again to continue' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Record<string, any> | undefined;
  if (!user || !user.totp_enabled) {
    return failAttempt(res, twoFaKey(req), 'Invalid verification code');
  }
  if (user.banned) {
    return res.status(403).json({ error: 'Account suspended' });
  }

  const secret = user.totp_secret ? decryptSecret(String(user.totp_secret)) : null;
  const hashes = loadRecoveryHashes(user.totp_recovery);
  const validCode = secret ? verifyTotp(secret, code) : false;
  const usedHash = validCode ? null : matchRecoveryCode(code, hashes);

  if (!validCode && !usedHash) {
    return failAttempt(res, twoFaKey(req), 'Invalid verification code');
  }

  clearLoginFailures(twoFaKey(req));

  let recoveryCodes: string[] | undefined;
  if (usedHash) {
    const remaining = hashes.filter((h) => h !== usedHash);
    recoveryCodes = generateRecoveryCodes();
    remaining.push(...recoveryCodes.map(hashRecoveryCode));
    db.prepare('UPDATE users SET totp_recovery = ? WHERE id = ?').run(JSON.stringify(remaining), user.id);
    auditLog({
      actorId: Number(user.id),
      actorName: String(user.username),
      action: '2fa.recovery',
      targetType: 'user',
      targetId: Number(user.id),
      detail: 'recovery code used during login, new set issued',
    });
  }

  clearChallenge(res);
  setToken(res, user.id, user.role);
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as Record<string, any>;
  return res.json({ user: toUser(fresh), ...(recoveryCodes ? { recoveryCodes } : {}) });
}

router.post('/login/2fa', authLimiter, bruteForceGuard(twoFaKey), handleTwoFaLogin);

router.post('/logout', (_req, res) => {
  res.clearCookie('token', { path: '/' });
  clearChallenge(res);
  return res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as Record<string, any>;
  return res.json({ user: toUser(user) });
});

// Begin 2FA enrollment: issue a fresh secret, QR code and recovery codes.
router.post('/2fa/start', authLimiter, requireAuth, async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as Record<string, any>;
  if (user.totp_enabled) {
    return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
  }
  try {
    const secret = generateSecret();
    const recoveryCodes = generateRecoveryCodes();
    const otpauthUrl = provisioningUri(secret, String(user.username));
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 240, margin: 1 });
    return res.json({ secret, otpauthUrl, qrDataUrl, recoveryCodes });
  } catch (e) {
    console.error('[open-audio] qrcode', e);
    return res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Confirm enrollment: verify a live code against the secret, then persist.
function handleEnableTwoFa(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const secret = typeof body.secret === 'string' ? body.secret.trim().toUpperCase() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const recoveryCodes = Array.isArray(body.recoveryCodes) ? (body.recoveryCodes as unknown[]) : [];

  if (!secret || !code) {
    return res.status(400).json({ error: 'Secret and verification code are required' });
  }
  if (!verifyTotp(secret, code)) {
    return res.status(400).json({ error: 'Invalid verification code — check that your authenticator is in sync' });
  }
  if (recoveryCodes.length === 0 || recoveryCodes.length > 20) {
    return res.status(400).json({ error: 'Recovery codes are required' });
  }
  for (const rc of recoveryCodes) {
    if (typeof rc !== 'string' || !isRecoveryCodeFormat(rc)) {
      return res.status(400).json({ error: 'Recovery codes are invalid' });
    }
  }

  const db = getDb();
  db.prepare(
    'UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_recovery = ?, totp_confirmed_at = ? WHERE id = ?',
  ).run(encryptSecret(secret), JSON.stringify(recoveryCodes.map((rc) => hashRecoveryCode(String(rc)))), Date.now(), req.user!.id);

  auditLog({
    actorId: req.user!.id,
    actorName: req.user!.username,
    action: '2fa.enable',
    targetType: 'user',
    targetId: req.user!.id,
  });

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as Record<string, any>;
  return res.json({ user: toUser(updated) });
}

router.post('/2fa/enable', authLimiter, requireAuth, handleEnableTwoFa);

// Disable 2FA (requires the account password).
function handleDisableTwoFa(req: Request, res: Response) {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return res.status(400).json({ error: 'Password is required to disable two-factor authentication' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as Record<string, any>;
  if (!user.totp_enabled) {
    return res.status(400).json({ error: 'Two-factor authentication is not enabled' });
  }
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_recovery = NULL, totp_confirmed_at = NULL WHERE id = ?').run(
    req.user!.id,
  );

  auditLog({
    actorId: req.user!.id,
    actorName: req.user!.username,
    action: '2fa.disable',
    targetType: 'user',
    targetId: req.user!.id,
  });

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as Record<string, any>;
  return res.json({ user: toUser(updated) });
}

router.post('/2fa/disable', authLimiter, requireAuth, handleDisableTwoFa);

export default router;
