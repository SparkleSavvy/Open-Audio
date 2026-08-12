import { NextFunction, Request, Response } from 'express';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, no dependencies)
// ---------------------------------------------------------------------------

interface WindowEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyFn?: (req: Request) => string;
}

export function rateLimit(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const max = options.max ?? 100;
  const message = options.message ?? 'Too many requests, please slow down';
  const keyFn = options.keyFn ?? ((req: Request) => req.ip ?? 'unknown');
  const buckets = new Map<string, WindowEntry>();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  timer.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFn(req);
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Brute-force protection for auth endpoints
// ---------------------------------------------------------------------------

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_LIMIT = 5;
const LOCK_STEPS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

interface Attempts {
  failures: number[];
  lockUntil: number;
}

const attempts = new Map<string, Attempts>();

const pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of attempts) {
    value.failures = value.failures.filter((t) => now - t < ATTEMPT_WINDOW_MS);
    if (value.failures.length === 0 && value.lockUntil <= now) attempts.delete(key);
  }
}, 60_000);
pruneTimer.unref();

export function loginLockRemaining(key: string): number {
  const entry = attempts.get(key);
  if (!entry) return 0;
  return Math.max(0, entry.lockUntil - Date.now());
}

// Records a failed login for a key. Returns remaining lockout ms (0 = unlocked).
export function registerLoginFailure(key: string): number {
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry) {
    entry = { failures: [], lockUntil: 0 };
    attempts.set(key, entry);
  }
  entry.failures = entry.failures.filter((t) => now - t < ATTEMPT_WINDOW_MS);
  entry.failures.push(now);
  const n = entry.failures.length;
  if (n >= ATTEMPT_LIMIT) {
    const step = Math.min(n - ATTEMPT_LIMIT, LOCK_STEPS_MS.length - 1);
    entry.lockUntil = now + LOCK_STEPS_MS[step];
  }
  return entry.lockUntil - now;
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}

export function bruteForceGuard(keyFn: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const remaining = loginLockRemaining(keyFn(req));
    if (remaining > 0) {
      res.setHeader('Retry-After', String(Math.ceil(remaining / 1000)));
      res.status(429).json({ error: 'Too many failed attempts, try again later' });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Magic-byte validation (rejects HTML/JS/zip disguised as media)
// ---------------------------------------------------------------------------

interface Signature {
  type: string;
  matches: (buf: Buffer) => boolean;
}

function prefix(buf: Buffer, offset: number, bytes: number[]): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function masked(buf: Buffer, offset: number, mask: number, value: number): boolean {
  return buf.length > offset && (buf[offset] & mask) === value;
}

const AUDIO_SIGNATURES: Signature[] = [
  { type: 'mp3', matches: (b) => prefix(b, 0, [0x49, 0x44, 0x33]) }, // "ID3" tag
  { type: 'flac', matches: (b) => prefix(b, 0, [0x66, 0x4c, 0x61, 0x43]) }, // "fLaC"
  { type: 'ogg', matches: (b) => prefix(b, 0, [0x4f, 0x67, 0x67, 0x53]) }, // "OggS"
  { type: 'wav', matches: (b) => prefix(b, 0, [0x52, 0x49, 0x46, 0x46]) && prefix(b, 8, [0x57, 0x41, 0x56, 0x45]) }, // "RIFF" + "WAVE"
  { type: 'm4a', matches: (b) => prefix(b, 4, [0x66, 0x74, 0x79, 0x70]) }, // "ftyp"
  { type: 'aac', matches: (b) => b.length > 1 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0 }, // ADTS sync (0xFF F0-F7; must precede MPEG, same prefix)
  { type: 'mp3', matches: (b) => masked(b, 0, 0xe0, 0xe0) }, // MPEG audio sync
  { type: 'webm', matches: (b) => prefix(b, 0, [0x1a, 0x45, 0xdf, 0xa3]) }, // EBML header
];

const IMAGE_SIGNATURES: Signature[] = [
  { type: 'image/jpeg', matches: (b) => prefix(b, 0, [0xff, 0xd8, 0xff]) },
  { type: 'image/png', matches: (b) => prefix(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { type: 'image/webp', matches: (b) => prefix(b, 0, [0x52, 0x49, 0x46, 0x46]) && prefix(b, 8, [0x57, 0x45, 0x42, 0x50]) }, // "RIFF" + "WEBP"
  { type: 'image/gif', matches: (b) => prefix(b, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || prefix(b, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) }, // "GIF87a"/"GIF89a"
];

export function sniffAudio(buf: Buffer): string | null {
  for (const sig of AUDIO_SIGNATURES) {
    if (sig.matches(buf)) return sig.type;
  }
  return null;
}

export function sniffImage(buf: Buffer): string | null {
  for (const sig of IMAGE_SIGNATURES) {
    if (sig.matches(buf)) return sig.type;
  }
  return null;
}

export function assertAudioSignature(buf: Buffer): boolean {
  return sniffAudio(buf) !== null;
}

export function assertImageSignature(buf: Buffer, mime: string): boolean {
  const sniffed = sniffImage(buf);
  return sniffed !== null && (mime === sniffed || mime.startsWith('image/'));
}

// ---------------------------------------------------------------------------
// Path containment (blocks ../ traversal out of the uploads root)
// ---------------------------------------------------------------------------

export function resolveInside(root: string, relPath: string): string | null {
  const rootAbs = path.resolve(root);
  const resolved = path.resolve(rootAbs, relPath);
  if (resolved === rootAbs) return null;
  if (!resolved.startsWith(rootAbs + path.sep)) return null;
  return resolved;
}

// ---------------------------------------------------------------------------
// CSRF defense-in-depth
// ---------------------------------------------------------------------------

// Cookies are the auth source, so state-changing requests must come from the
// site itself. SameSite=Lax already stops cross-site cookie sending; this
// additionally rejects cross-origin state-changing requests by checking the
// Origin (or Referer as a fallback) against the request's Host. Browsers
// never let scripts set Origin, so a mismatch can only be a cross-site
// request. Requests with neither header (CLI, curl, server-to-server) pass.
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const source = (req.headers.origin || req.headers.referer) as string | undefined;
  if (!source) return next();

  let sourceHost: string;
  try {
    sourceHost = new URL(source).hostname.toLowerCase();
  } catch {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  if (sourceHost && sourceHost !== req.hostname.toLowerCase()) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  return next();
}

// ---------------------------------------------------------------------------
// SSRF guard for server-side fetching of externally hosted audio
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | Number(octet), 0) >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  return (ipInt & mask) === (baseInt & mask);
}

const PRIVATE_V4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

function isPrivateV4(ip: string): boolean {
  return PRIVATE_V4_CIDRS.some((cidr) => ipv4InCidr(ip, cidr));
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1' || lower === '::ffff:0:0') return true;
  // Unique-local fc00::/7 and link-local fe80::/10.
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version === 6) return isPrivateV6(address);
  return true; // Not a parseable IP — treat as unsafe.
}

// An external audio URL must be http(s) and must not resolve to loopback,
// link-local, private, or reserved ranges. Called before fetching upstream.
export async function isSafeExternalUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;

  if (net.isIP(hostname) !== 0) {
    return !isPrivateAddress(hostname);
  }
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.length > 0 && records.every((r) => !isPrivateAddress(r.address));
  } catch {
    return false;
  }
}
