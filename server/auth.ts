import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config';

export interface TokenPayload {
  userId: number;
  role: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256', expiresIn: '7d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof decoded === 'object' && decoded !== null && 'userId' in decoded) {
      return { userId: Number((decoded as jwt.JwtPayload).userId), role: String((decoded as jwt.JwtPayload).role) };
    }
    return null;
  } catch {
    return null;
  }
}

// Short-lived token minted only after a successful password check. It proves
// the caller passed the password step before the 2FA code is accepted, so a
// 2FA endpoint cannot be hammered without the account password.
export function signChallengeToken(userId: number): string {
  return jwt.sign({ userId, purpose: '2fa' }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '5m' });
}

export function verifyChallengeToken(token: string): number | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      (decoded as jwt.JwtPayload).purpose === '2fa' &&
      'userId' in decoded
    ) {
      return Number((decoded as jwt.JwtPayload).userId);
    }
    return null;
  } catch {
    return null;
  }
}
