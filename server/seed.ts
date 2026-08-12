import type { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './auth';

export interface SeedUserOptions {
  username: string;
  password?: string;
  email?: string;
}

export type SeedRole = 'admin' | 'owner';

export function upsertAdmin(db: DatabaseSync, opts: SeedUserOptions): boolean {
  return upsertUser(db, { ...opts, role: 'admin' });
}

export function upsertOwner(db: DatabaseSync, opts: SeedUserOptions): boolean {
  return upsertUser(db, { ...opts, role: 'owner' });
}

// Creates the account, or updates it when it already exists. A missing
// `password` leaves an existing password untouched — only a fresh account
// (or an explicit new password) rotates it.
export function upsertUser(
  db: DatabaseSync,
  { username, password, email, role }: SeedUserOptions & { role: SeedRole },
): boolean {
  const existing = db
    .prepare('SELECT id FROM users WHERE lower(username) = lower(?)')
    .get(username.toLowerCase()) as { id: number } | undefined;

  if (existing) {
    if (password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), existing.id);
    }
    if (email) {
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, existing.id);
    }
    if (role === 'owner') {
      db.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(existing.id);
    }
    return false;
  }

  db.prepare('INSERT INTO users (username, email, password_hash, role, created_at, last_seen) VALUES (?,?,?,?,?,?)').run(
    username,
    email || null,
    hashPassword(password ?? ''),
    role,
    Date.now(),
    Date.now(),
  );
  return true;
}
