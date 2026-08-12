import { getDb } from './db';

export interface NotifyOptions {
  type: string;
  trackId?: number | null;
  trackTitle: string;
  message: string;
}

export function notify(userId: number | null | undefined, opts: NotifyOptions): void {
  if (userId == null) return;
  getDb()
    .prepare(
      'INSERT INTO notifications (user_id, type, track_id, track_title, message, read, created_at) VALUES (?,?,?,?,?,0,?)',
    )
    .run(userId, opts.type, opts.trackId ?? null, opts.trackTitle, opts.message, Date.now());
}
