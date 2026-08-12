import { getDb } from './db';

export type AuditAction =
  | 'track.verify'
  | 'track.suspend'
  | 'track.unsuspend'
  | 'track.reject'
  | 'track.delete'
  | 'track.resubmit'
  | 'track.delete-request'
  | 'track.delete-approve'
  | 'track.delete-reject'
  | 'track.scan'
  | 'user.ban'
  | 'user.unban'
  | 'user.promote'
  | 'user.demote'
  | 'user.supporter'
  | 'user.password'
  | 'user.purge'
  | 'notify'
  | 'backup'
  | 'restore'
  | 'prune'
  | 'vacuum'
  | 'secret.rotate'
  | 'removal.request'
  | 'removal.cancel'
  | 'removal.confirm'
  | '2fa.enable'
  | '2fa.disable'
  | '2fa.recovery';

export interface AuditEntry {
  actorId?: number | null;
  actorName?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: number | null;
  detail?: string;
}

export function auditLog(entry: AuditEntry): void {
  getDb()
    .prepare(
      'INSERT INTO admin_log (actor_id, actor_name, action, target_type, target_id, detail, created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run(
      entry.actorId ?? null,
      entry.actorName ?? null,
      entry.action,
      entry.targetType ?? '',
      entry.targetId ?? null,
      entry.detail ?? '',
      Date.now(),
    );
}

export function recentAudit(limit = 50) {
  const rows = getDb()
    .prepare('SELECT * FROM admin_log ORDER BY id DESC LIMIT ?')
    .all(limit) as Record<string, any>[];
  return rows.map((r) => ({
    id: Number(r.id),
    actorId: r.actor_id != null ? Number(r.actor_id) : null,
    actorName: r.actor_name ?? null,
    action: String(r.action),
    targetType: String(r.target_type ?? ''),
    targetId: r.target_id != null ? Number(r.target_id) : null,
    detail: String(r.detail ?? ''),
    createdAt: Number(r.created_at),
  }));
}
