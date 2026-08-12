import { Router } from 'express';
import { getDb } from '../db';
import { optionalAuth, requireAuth } from '../middleware';
import { toTrack } from '../serialize';
import { TRACK_SELECT, viewerParams } from '../trackSelect';

const router = Router();

type Row = Record<string, any>;

// GET /api/users/:id — public profile + counts + viewer follow state
router.get('/:id', optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
  const db = getDb();
  const user = db
    .prepare('SELECT id, username, avatar_url, bio, location, supporter, created_at FROM users WHERE id = ? AND banned = 0')
    .get(id) as Row | undefined;
  if (!user) return res.status(404).json({ error: 'User not found' });

  const followers = (db.prepare('SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?').get(id) as { c: number }).c;
  const following = (db.prepare('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?').get(id) as { c: number }).c;
  const trackCount = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM tracks WHERE uploader_id = ? AND status IN ('verified','approved')`)
      .get(id) as { c: number }
  ).c;
  const viewerId = req.user?.id ?? -1;
  const isFollowing = Boolean(
    db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?').get(viewerId, id),
  );

  return res.json({
    profile: {
      id: Number(user.id),
      username: String(user.username),
      avatar_url: user.avatar_url ?? null,
      bio: user.bio ?? '',
      location: user.location ?? '',
      supporter: Boolean(user.supporter),
      created_at: Number(user.created_at),
      followers: Number(followers),
      following: Number(following),
      trackCount: Number(trackCount),
      isFollowing,
    },
  });
});

// POST /api/users/:id/follow — toggle follow (auth)
router.post('/:id/follow', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) return res.status(400).json({ error: 'You cannot follow yourself' });
  const db = getDb();
  const target = db.prepare('SELECT id FROM users WHERE id = ? AND banned = 0').get(id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const existing = db
    .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
    .get(req.user!.id, id);
  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(req.user!.id, id);
  } else {
    db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(req.user!.id, id, Date.now());
  }
  const followers = (db.prepare('SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?').get(id) as { c: number }).c;
  return res.json({ following: !existing, followers: Number(followers) });
});

// GET /api/users/:id/tracks?sort=latest|popular — user's uploads (public verified/approved)
router.get('/:id/tracks', optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND banned = 0').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const viewerId = req.user?.id ?? -1;
  const isOwnerOrAdmin = req.user && (Number(req.user.id) === id || req.user.role === 'admin');
  const statusFilter = isOwnerOrAdmin
    ? "t.status IN ('pending','verified','suspended','rejected','approved')"
    : "t.status IN ('verified','approved')";
  const order = req.query.sort === 'popular' ? 'ORDER BY t.plays DESC, t.created_at DESC' : 'ORDER BY t.created_at DESC';
  const rows = db
    .prepare(`${TRACK_SELECT} WHERE t.uploader_id = ? AND ${statusFilter} ${order}`)
    .all(...viewerParams(viewerId), id) as Row[];
  return res.json({ tracks: rows.map((r) => toTrack(r, Boolean(r.liked), Boolean(r.reposted))) });
});

// GET /api/users/:id/reposts — tracks reposted by the user (public verified/approved only)
router.get('/:id/reposts', optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND banned = 0').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const viewerId = req.user?.id ?? -1;
  const rows = db
    .prepare(
      `SELECT t.*, u.username AS uploader_username, u.avatar_url AS uploader_avatar,
        EXISTS(SELECT 1 FROM likes l WHERE l.track_id = t.id AND l.user_id = ?) AS liked,
        1 AS reposted
      FROM reposts r
      JOIN tracks t ON t.id = r.track_id
      LEFT JOIN users u ON u.id = t.uploader_id
      WHERE r.user_id = ? AND t.status IN ('verified','approved')
      ORDER BY r.created_at DESC`,
    )
    .all(viewerId, id) as Row[];
  return res.json({ tracks: rows.map((r) => toTrack(r, Boolean(r.liked), true)) });
});

// GET /api/users/:id/likes — tracks liked by the user (public verified/approved only)
router.get('/:id/likes', optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND banned = 0').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const viewerId = req.user?.id ?? -1;
  const rows = db
    .prepare(
      `SELECT t.*, u.username AS uploader_username, u.avatar_url AS uploader_avatar,
        EXISTS(SELECT 1 FROM likes l WHERE l.track_id = t.id AND l.user_id = ?) AS liked,
        EXISTS(SELECT 1 FROM reposts r WHERE r.track_id = t.id AND r.user_id = ?) AS reposted
      FROM likes lk
      JOIN tracks t ON t.id = lk.track_id
      LEFT JOIN users u ON u.id = t.uploader_id
      WHERE lk.user_id = ? AND t.status IN ('verified','approved')
      ORDER BY lk.created_at DESC`,
    )
    .all(viewerId, viewerId, id) as Row[];
  return res.json({ tracks: rows.map((r) => toTrack(r, Boolean(r.liked), Boolean(r.reposted))) });
});

// GET /api/users/:id/following — users followed by this user
router.get('/:id/following', optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid user id' });
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND banned = 0').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const viewerId = req.user?.id ?? -1;
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, u.location,
        (SELECT COUNT(*) FROM follows f2 WHERE f2.followee_id = u.id) AS followers,
        EXISTS(SELECT 1 FROM follows fv WHERE fv.follower_id = ? AND fv.followee_id = u.id) AS is_following
      FROM follows f
      JOIN users u ON u.id = f.followee_id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC
      LIMIT 50`,
    )
    .all(viewerId, id) as Row[];
  return res.json({
    users: rows.map((r) => ({
      user: { id: Number(r.id), username: String(r.username), avatarUrl: r.avatar_url ?? null },
      location: r.location ?? '',
      followers: Number(r.followers),
      isFollowing: Boolean(r.is_following),
    })),
  });
});

export default router;
