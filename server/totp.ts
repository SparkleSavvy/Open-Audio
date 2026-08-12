import crypto from 'node:crypto';
import { config } from './config';

// RFC 4648 base32 (A-Z, 2-7)
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

const DEFAULT_STEP = 30;
const DEFAULT_DIGITS = 6;

// RFC 6238 TOTP (HMAC-SHA1). Only used for verification + tests.
export function totp(secret: string, timestamp = Date.now()): string {
  const counter = Math.floor(timestamp / 1000 / DEFAULT_STEP);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** DEFAULT_DIGITS).padStart(DEFAULT_DIGITS, '0');
}

export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    const candidate = totp(secret, now + i * DEFAULT_STEP * 1000);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))) return true;
  }
  return false;
}

const ISSUER = 'Open Audio';

export function provisioningUri(secret: string, account: string): string {
  const params = new URLSearchParams({
    secret,
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_STEP),
  });
  return `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(account)}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Recovery codes (single-use backup access)
// ---------------------------------------------------------------------------

const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let raw = '';
    for (let j = 0; j < 16; j++) raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    codes.push(raw.replace(/(.{4})(?=.)/g, '$1-'));
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function isRecoveryCodeFormat(code: string): boolean {
  return normalizeRecoveryCode(code).length === 16;
}

// Returns the matching stored hash for a single-use recovery code, or null.
export function matchRecoveryCode(code: string, hashes: string[]): string | null {
  const hash = hashRecoveryCode(normalizeRecoveryCode(code));
  return hashes.find((h) => h === hash) ?? null;
}

// ---------------------------------------------------------------------------
// Secret at-rest encryption (key derived from JWT_SECRET)
// ---------------------------------------------------------------------------

function cipherKey(): Buffer {
  return crypto.scryptSync(config.jwtSecret, 'open-audio-totp-v1', 32);
}

export function encryptSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

// A stored secret is "v1:<iv>:<tag>:<ciphertext>" with all four parts present.
function isV1Envelope(parts: string[]): boolean {
  if (parts.length !== 4) return false;
  const [ver, ivHex, tagHex, dataHex] = parts;
  return ver === 'v1' && Boolean(ivHex) && Boolean(tagHex) && Boolean(dataHex);
}

export function decryptSecret(stored: string): string | null {
  try {
    const parts = stored.split(':');
    if (!isV1Envelope(parts)) return null;
    const [, ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
