import { Request, Response, Router } from 'express';
import { requireAdmin, requireOwner } from '../middleware';
import { toTrack, toUser } from '../serialize';
import { recentAudit } from '../audit';
import { rateLimit } from '../security';
import {
  cancelRemovalRequest,
  confirmRemovalRequest,
  createRemovalRequest,
  listRemovalRequests,
} from '../removal';
import {
  AppError,
  approveTrackDeletionRequest,
  deleteTrack,
  getAdminStats,
  listTrackDeleteRequests,
  listTracksForModeration,
  listUsers,
  rejectTrack,
  rejectTrackDeletionRequest,
  requestTrackDeletion,
  resubmitTrack,
  setUserBanned,
  setUserRole,
  setUserSupporter,
  suspendTrack,
  unsuspendTrack,
  verifyTrack,
} from '../admin';

const router = Router();

const VALID_STATUSES = ['pending', 'verified', 'suspended', 'rejected', 'all'];

type Handler = (req: Request, res: Response) => void;

function wrap(fn: Handler): Handler {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (e) {
      if (e instanceof AppError) {
        return res.status(e.status).json({ error: e.message });
      }
      console.error('[open-audio] admin', e);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

const actor = (req: Request) => ({ id: req.user!.id, username: req.user!.username });

// GET /api/admin/tracks?status=pending|verified|suspended|rejected|all
router.get(
  '/tracks',
  requireAdmin,
  wrap((req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const rows = listTracksForModeration(status);
    return res.json({ tracks: rows.map((r) => toTrack(r, false)) });
  }),
);

// POST /api/admin/tracks/:id/verify — publish (approved → verified)
router.post(
  '/tracks/:id/verify',
  requireAdmin,
  wrap((req, res) => {
    const track = verifyTrack(Number(req.params.id), actor(req));
    return res.json({ track: toTrack(track) });
  }),
);

// POST /api/admin/tracks/:id/suspend — temporarily disable playback
router.post(
  '/tracks/:id/suspend',
  requireAdmin,
  wrap((req, res) => {
    const track = suspendTrack(Number(req.params.id), actor(req));
    return res.json({ track: toTrack(track) });
  }),
);

// POST /api/admin/tracks/:id/unsuspend — re-enable playback
router.post(
  '/tracks/:id/unsuspend',
  requireAdmin,
  wrap((req, res) => {
    const track = unsuspendTrack(Number(req.params.id), actor(req));
    return res.json({ track: toTrack(track) });
  }),
);

// POST /api/admin/tracks/:id/reject  body: { reason }
router.post(
  '/tracks/:id/reject',
  requireAdmin,
  wrap((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const track = rejectTrack(Number(req.params.id), reason, actor(req));
    return res.json({ track: toTrack(track) });
  }),
);

// POST /api/admin/tracks/:id/resubmit — send a rejected track back to pending
router.post(
  '/tracks/:id/resubmit',
  requireAdmin,
  wrap((req, res) => {
    const track = resubmitTrack(Number(req.params.id), actor(req));
    return res.json({ track: toTrack(track) });
  }),
);

// DELETE /api/admin/tracks/:id — hard delete (owner only)
router.delete(
  '/tracks/:id',
  requireOwner,
  wrap((req, res) => {
    deleteTrack(Number(req.params.id), actor(req));
    return res.json({ ok: true });
  }),
);

// POST /api/admin/tracks/:id/delete-request  body: { reason } — admin/owner request deletion
router.post(
  '/tracks/:id/delete-request',
  requireAdmin,
  wrap((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const request = requestTrackDeletion(Number(req.params.id), reason, actor(req));
    return res.status(201).json({ request });
  }),
);

// GET /api/admin/track-delete-requests — all deletion requests (pending first)
router.get(
  '/track-delete-requests',
  requireAdmin,
  wrap((_req, res) => {
    return res.json({ requests: listTrackDeleteRequests() });
  }),
);

// POST /api/admin/track-delete-requests/:id/approve — owner approves, track is deleted
router.post(
  '/track-delete-requests/:id/approve',
  requireOwner,
  wrap((req, res) => {
    const request = approveTrackDeletionRequest(Number(req.params.id), actor(req));
    return res.json({ request });
  }),
);

// POST /api/admin/track-delete-requests/:id/reject — owner rejects the request
router.post(
  '/track-delete-requests/:id/reject',
  requireOwner,
  wrap((req, res) => {
    const request = rejectTrackDeletionRequest(Number(req.params.id), actor(req));
    return res.json({ request });
  }),
);

// GET /api/admin/users
router.get(
  '/users',
  requireAdmin,
  wrap((_req, res) => {
    const rows = listUsers();
    return res.json({
      users: rows.map((r) => ({ ...toUser(r), trackCount: Number(r.track_count) })),
    });
  }),
);

// PATCH /api/admin/users/:id  body: { banned?, role? }
// Bans/unbans are allowed for admins and owners; role changes are owner-only.
router.patch(
  '/users/:id',
  requireAdmin,
  wrap((req, res) => {
    const id = Number(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    let user: Record<string, any> | null = null;
    if (typeof body.banned === 'boolean') {
      user = setUserBanned(String(id), body.banned, actor(req));
    }
    if (typeof body.role === 'string') {
      if (req.user!.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
      if (!['user', 'admin'].includes(body.role)) return res.status(400).json({ error: 'Invalid role' });
      user = setUserRole(String(id), body.role as 'user' | 'admin', actor(req));
    }
    if (typeof body.supporter === 'boolean') {
      if (req.user!.role !== 'owner') return res.status(403).json({ error: 'Forbidden' });
      user = setUserSupporter(String(id), body.supporter, actor(req));
    }
    if (!user) return res.status(400).json({ error: 'Nothing to update' });
    return res.json({ user: toUser(user) });
  }),
);

// GET /api/admin/stats
router.get(
  '/stats',
  requireAdmin,
  wrap((_req, res) => {
    return res.json(getAdminStats());
  }),
);

// GET /api/admin/audit — recent admin_log entries
router.get(
  '/audit',
  requireAdmin,
  wrap((req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    return res.json({ entries: recentAudit(limit) });
  }),
);

// ---------------------------------------------------------------------------
// Verified software-uninstall flow
// ---------------------------------------------------------------------------

// Key-auth requests coming from the CLI utility are IP rate limited.
const removalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many removal requests, please slow down',
});

// GET /api/admin/removal-request — all removal requests (owner view)
router.get(
  '/removal-request',
  requireAdmin,
  wrap((_req, res) => {
    return res.json({ requests: listRemovalRequests() });
  }),
);

// POST /api/admin/removal-request  body: { key, reason }  (CLI utility)
router.post(
  '/removal-request',
  removalLimiter,
  wrap((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = typeof body.key === 'string' ? body.key : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!key) return res.status(400).json({ error: 'Removal key is required' });
    const request = createRemovalRequest(key, reason);
    return res.status(201).json({ request });
  }),
);

// POST /api/admin/removal-request/:id/cancel — owner dismisses the request
router.post(
  '/removal-request/:id/cancel',
  requireAdmin,
  wrap((req, res) => {
    const request = cancelRemovalRequest(Number(req.params.id), actor(req));
    return res.json({ request });
  }),
);

// POST /api/admin/removal-request/:id/confirm  body: { key } — wipes the server (owner only)
router.post(
  '/removal-request/:id/confirm',
  requireOwner,
  wrap((req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = typeof body.key === 'string' ? body.key : '';
    if (!key) return res.status(400).json({ error: 'Removal key is required' });
    confirmRemovalRequest(Number(req.params.id), key, actor(req));
    return res.json({ ok: true });
  }),
);

export default router;
