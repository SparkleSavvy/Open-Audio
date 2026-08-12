import { NextFunction, Request, Response } from 'express';
import { verifyToken } from './auth';
import { getDb } from './db';

export interface AuthUser {
  id: number;
  username: string;
  role: 'user' | 'admin' | 'owner';
  banned: number;
  supporter: number;
  avatar_url: string | null;
  last_seen: number | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const UNAUTHORIZED = { error: 'Authentication required' };
const FORBIDDEN = { error: 'Forbidden' };

export function loadUser(userId: number): AuthUser | null {
  const row = getDb()
    .prepare('SELECT id, username, role, banned, supporter, avatar_url, last_seen FROM users WHERE id = ?')
    .get(userId) as unknown as AuthUser | undefined;
  return row ?? null;
}

// Throttled "last activity" stamp: at most one write per user per hour.
// Keeps `last_seen` fresh enough for the inactive-account purge without
// writing to the database on every request.
const ACTIVITY_INTERVAL_MS = 60 * 60 * 1000;

export function touchUserActivity(user: AuthUser): void {
  const now = Date.now();
  if (user.last_seen != null && now - user.last_seen < ACTIVITY_INTERVAL_MS) return;
  getDb().prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, user.id);
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.token;
  const payload = token && typeof token === 'string' ? verifyToken(token) : null;
  if (payload) {
    const user = loadUser(payload.userId);
    if (user && !user.banned) {
      req.user = user;
      touchUserActivity(user);
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.token;
  const payload = token && typeof token === 'string' ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json(UNAUTHORIZED);
    return;
  }
  const user = loadUser(payload.userId);
  if (!user) {
    res.status(401).json(UNAUTHORIZED);
    return;
  }
  if (user.banned) {
    res.clearCookie('token', { path: '/' });
    res.status(403).json({ error: 'Account suspended' });
    return;
  }
  req.user = user;
  touchUserActivity(user);
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'owner') {
      res.status(403).json(FORBIDDEN);
      return;
    }
    next();
  });
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'owner') {
      res.status(403).json(FORBIDDEN);
      return;
    }
    next();
  });
}
