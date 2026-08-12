import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db';
import { optionalAuth, requireAuth } from '../middleware';
import { toComment, toTrack } from '../serialize';
import { config } from '../config';
import { notify } from '../notify';
import { isSafeExternalUrl, resolveInside } from '../security';
import { TRACK_SELECT, viewerParams } from '../trackSelect';

const router = Router();

type Row = Record<string, any>;

// Statuses that are publicly visible and playable (bare column, no alias)
const PUBLIC_SQL = "status IN ('verified','approved')";

function findTrack(viewerId: number, id: number) {
  return getDb()
    .prepare(`${TRACK_SELECT} WHERE t.id = ?`)
    .get(...viewerParams(viewerId), id) as Row | undefined;
}

function canView(req: import('express').Request, track: Row): boolean {
  if (track.status === 'verified' || track.status === 'suspended' || track.status === 'approved') return true;
  if (req.user && Number(req.user.id) === Number(track.uploader_id)) return true;
  if (req.user?.role === 'admin') return true;
  return false;
}

function removeTrackFiles(track: Row) {
  const files = [track.audio_url, track.cover_url].filter(Boolean) as string[];
  for (const url of files) {
    if (!url.startsWith('/uploads/')) continue;
    const abs = resolveInside(config.uploadDir, url.replace(/^\/uploads\//, ''));
    if (!abs) continue;
    try {
      fs.unlinkSync(abs);
    } catch {
      /* file already gone */
    }
  }
}

// GET /api/tracks/me — current user's uploads across all statuses (must be before /:id)
router.get('/me', requireAuth, (req, res) => {
  const rows = getDb()
    .prepare(`${TRACK_SELECT} WHERE t.uploader_id = ? ORDER BY t.created_at DESC`)
    .all(...viewerParams(req.user!.id), req.user!.id) as Row[];
  return res.json({ tracks: rows.map((r) => toTrack(r, Boolean(r.liked), Boolean(r.reposted))) });
});

// GET /api/tracks?q=&sort=&liked=1&limit=&offset=
router.get('/', optionalAuth, (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'latest';
  const likedOnly = req.query.liked === '1';
  const limit = Math.min(Number(req.query.limit) || 48, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const viewerId = req.user?.id ?? -1;

  const where: string[] = [];
  const params: (string | number)[] = viewerParams(viewerId);

  if (likedOnly) {
    where.push('t.id IN (SELECT track_id FROM likes WHERE user_id = ?)');
    params.push(req.user?.id ?? -1);
  } else {
    where.push("t.status IN ('verified','suspended','approved')");
  }
  if (q) {
    where.push('(lower(t.title) LIKE ? OR lower(t.artist) LIKE ?)');
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like);
  }

  const order =
    sort === 'popular'
      ? 'ORDER BY t.plays DESC, t.created_at DESC'
      : 'ORDER BY t.created_at DESC';

  const rows = getDb()
    .prepare(`${TRACK_SELECT} WHERE ${where.join(' AND ')} ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Row[];

  return res.json({ tracks: rows.map((r) => toTrack(r, Boolean(r.liked), Boolean(r.reposted))) });
});

// GET /api/tracks/:id
router.get('/:id', optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid track id' });
  const track = findTrack(req.user?.id ?? -1, id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (!canView(req, track)) {
    return res.status(403).json({ error: 'This track is awaiting moderation' });
  }
  const liked = req.user ? Boolean(track.liked) : false;
  return res.json({ track: toTrack(track, liked, Boolean(track.reposted)) });
});

// GET /api/tracks/:id/download — stream; lossless (FLAC/WAV/ALAC) requires a supporter badge
router.get('/:id/download', optionalAuth, async (req, res) => {
  const id = Number(req.params.id);
  const track = getDb()
    .prepare(`SELECT * FROM tracks WHERE id = ? AND ${PUBLIC_SQL}`)
    .get(id) as Row | undefined;
  if (!track) return res.status(404).json({ error: 'Track not found' });

  if (track.lossless && !req.user?.supporter && req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Only supporters can download lossless (FLAC) tracks' });
  }

  const fileExt = track.audio_url.startsWith('/uploads/') ? path.extname(track.audio_url) : '.mp3';
  const filename = `${track.artist} - ${track.title}${fileExt}`.replace(/[\\/:*?"<>|]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);

  if (req.method === 'HEAD') return res.end();

  if (track.audio_url.startsWith('http://') || track.audio_url.startsWith('https://')) {
    // Never fetch loopback/private/link-local targets — the URL in the DB
    // could point at internal services (SSRF) if it ever got tampered with.
    if (!(await isSafeExternalUrl(track.audio_url))) {
      return res.status(502).json({ error: 'Could not reach audio source' });
    }
    let upstream: Response;
    try {
      upstream = await fetch(track.audio_url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return res.status(502).json({ error: 'Could not reach audio source' });
    }
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: 'Could not reach audio source' });
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg');
    const reader = upstream.body.getReader();
    const abort = () => reader.cancel().catch(() => {});
    res.on('close', abort);
    res.on('error', abort);
    const MAX_STREAM_BYTES = 500 * 1024 * 1024;
    let streamed = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        streamed += value.length;
        // Once bytes are flowing we can no longer send a status — tear the
        // connection down instead (a headers-sent error here would otherwise
        // be an unhandled rejection that crashes the process).
        if (streamed > MAX_STREAM_BYTES || res.destroyed) {
          abort();
          return res.destroy();
        }
        res.write(value);
      }
      return res.end();
    } catch {
      if (!res.writableEnded && !res.destroyed) res.destroy();
    }
  }

  const abs = resolveInside(config.uploadDir, track.audio_url.replace(/^\/uploads\//, ''));
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Audio file not found' });

  const ext = path.extname(track.audio_url).toLowerCase();
  const CONTENT_TYPES: Record<string, string> = {
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.mp3': 'audio/mpeg',
  };
  res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', fs.statSync(abs).size);
  const stream = fs.createReadStream(abs);
  stream.on('error', () => {
    if (res.headersSent) res.destroy();
    else res.status(500).json({ error: 'Could not read audio file' });
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

// POST /api/tracks/:id/like — toggle like (auth)
router.post('/:id/like', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const track = findTrack(req.user!.id, id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (!['verified', 'approved', 'suspended'].includes(track.status)) {
    return res.status(403).json({ error: 'This track is not public yet' });
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT 1 FROM likes WHERE user_id = ? AND track_id = ?')
    .get(req.user!.id, id);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE user_id = ? AND track_id = ?').run(req.user!.id, id);
    db.prepare('UPDATE tracks SET likes = MAX(0, likes - 1) WHERE id = ?').run(id);
  } else {
    db.prepare('INSERT INTO likes (user_id, track_id, created_at) VALUES (?,?,?)').run(req.user!.id, id, Date.now());
    db.prepare('UPDATE tracks SET likes = likes + 1 WHERE id = ?').run(id);
  }
  const updated = db.prepare('SELECT likes FROM tracks WHERE id = ?').get(id) as { likes: number };
  return res.json({ liked: !existing, likes: updated.likes });
});

// POST /api/tracks/:id/play — record a play (public), log for fans ranking when authed
router.post('/:id/play', optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  db.prepare(`UPDATE tracks SET plays = plays + 1 WHERE id = ? AND ${PUBLIC_SQL}`).run(id);
  if (req.user) {
    db.prepare('INSERT INTO track_plays (track_id, user_id, created_at) VALUES (?,?,?)').run(id, req.user.id, Date.now());
  }
  return res.json({ ok: true });
});

// GET /api/tracks/:id/comments?filter=newest|oldest
router.get('/:id/comments', optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  const track = getDb().prepare('SELECT id FROM tracks WHERE id = ?').get(id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  const order = req.query.filter === 'oldest' ? 'ASC' : 'DESC';
  const viewerId = req.user?.id ?? -1;
  const rows = getDb()
    .prepare(
      `SELECT c.*, u.username, u.avatar_url,
         EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) AS liked
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.track_id = ?
       ORDER BY c.created_at ${order}`,
    )
    .all(viewerId, id) as Row[];
  return res.json({ comments: rows.map(toComment) });
});

// POST /api/tracks/:id/comments — add a comment at a track position (auth)
router.post('/:id/comments', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const track = getDb()
    .prepare(`SELECT * FROM tracks WHERE id = ? AND ${PUBLIC_SQL}`)
    .get(id) as Row | undefined;
  if (!track) return res.status(404).json({ error: 'Track not found' });

  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'Comment cannot be empty' });
  if (body.length > 1000) return res.status(400).json({ error: 'Comment is too long' });
  const ts = Math.max(0, Math.min(Number(req.body?.ts) || 0, Number(track.duration) || 0));
  const replyToRaw = req.body?.replyTo;
  const replyTo = Number.isInteger(replyToRaw) ? Number(replyToRaw) : null;
  if (replyTo != null) {
    const parent = getDb().prepare('SELECT id FROM comments WHERE id = ? AND track_id = ?').get(replyTo, id);
    if (!parent) return res.status(400).json({ error: 'Reply target not found' });
  }

  const db = getDb();
  const info = db
    .prepare('INSERT INTO comments (track_id, user_id, body, ts, reply_to, created_at) VALUES (?,?,?,?,?,?)')
    .run(id, req.user!.id, body, ts, replyTo, Date.now());
  const row = db
    .prepare(
      `SELECT c.*, u.username, u.avatar_url, 0 AS liked
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`,
    )
    .get(Number(info.lastInsertRowid)) as Row;

  if (track.uploader_id != null && Number(track.uploader_id) !== req.user!.id) {
    notify(Number(track.uploader_id), {
      type: 'track_comment',
      trackId: id,
      trackTitle: String(track.title),
      message: `${req.user!.username} commented on your track "${track.title}"`,
    });
  }
  return res.status(201).json({ comment: toComment(row) });
});

// POST /api/tracks/comments/:id/like — toggle like on a comment (auth)
router.post('/comments/:id/like', requireAuth, (req, res) => {
  const cid = Number(req.params.id);
  const db = getDb();
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(cid) as Row | undefined;
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const existing = db
    .prepare('SELECT 1 FROM comment_likes WHERE user_id = ? AND comment_id = ?')
    .get(req.user!.id, cid);
  if (existing) {
    db.prepare('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?').run(req.user!.id, cid);
    db.prepare('UPDATE comments SET likes = MAX(0, likes - 1) WHERE id = ?').run(cid);
  } else {
    db.prepare('INSERT INTO comment_likes (user_id, comment_id, created_at) VALUES (?,?,?)').run(req.user!.id, cid, Date.now());
    db.prepare('UPDATE comments SET likes = likes + 1 WHERE id = ?').run(cid);
  }
  const updated = db.prepare('SELECT likes FROM comments WHERE id = ?').get(cid) as { likes: number };
  return res.json({ liked: !existing, likes: updated.likes });
});

// DELETE /api/tracks/comments/:id — comment author or admin
router.delete('/comments/:id', requireAuth, (req, res) => {
  const cid = Number(req.params.id);
  const comment = getDb().prepare('SELECT * FROM comments WHERE id = ?').get(cid) as Row | undefined;
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (Number(comment.user_id) !== req.user!.id && req.user!.role !== 'admin' && req.user!.role !== 'owner') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  getDb().prepare('DELETE FROM comments WHERE id = ?').run(cid);
  return res.json({ ok: true });
});

// POST /api/tracks/:id/repost — toggle repost (auth)
router.post('/:id/repost', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const track = findTrack(req.user!.id, id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (!['verified', 'approved', 'suspended'].includes(track.status)) {
    return res.status(403).json({ error: 'This track is not public yet' });
  }
  const db = getDb();
  const existing = db
    .prepare('SELECT 1 FROM reposts WHERE user_id = ? AND track_id = ?')
    .get(req.user!.id, id);
  if (existing) {
    db.prepare('DELETE FROM reposts WHERE user_id = ? AND track_id = ?').run(req.user!.id, id);
    db.prepare('UPDATE tracks SET reposts = MAX(0, reposts - 1) WHERE id = ?').run(id);
  } else {
    db.prepare('INSERT INTO reposts (user_id, track_id, created_at) VALUES (?,?,?)').run(req.user!.id, id, Date.now());
    db.prepare('UPDATE tracks SET reposts = reposts + 1 WHERE id = ?').run(id);
  }
  const updated = db.prepare('SELECT reposts FROM tracks WHERE id = ?').get(id) as { reposts: number };
  return res.json({ reposted: !existing, reposts: updated.reposts });
});

// GET /api/tracks/:id/fans — top 5 listeners (auth plays only)
router.get('/:id/fans', (req, res) => {
  const id = Number(req.params.id);
  const track = getDb().prepare(`SELECT id FROM tracks WHERE id = ? AND ${PUBLIC_SQL}`).get(id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  const rows = getDb()
    .prepare(
      `SELECT u.id, u.username, u.avatar_url, COUNT(*) AS plays
       FROM track_plays tp JOIN users u ON u.id = tp.user_id
       WHERE tp.track_id = ? AND tp.user_id IS NOT NULL
       GROUP BY tp.user_id
       ORDER BY plays DESC, u.username ASC
       LIMIT 5`,
    )
    .all(id) as Row[];
  return res.json({
    fans: rows.map((r) => ({
      user: { id: Number(r.id), username: String(r.username), avatarUrl: r.avatar_url ?? null },
      plays: Number(r.plays),
    })),
  });
});

// POST /api/tracks/:id/resubmit — uploader resubmits a rejected track for moderation
router.post('/:id/resubmit', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const track = getDb().prepare('SELECT * FROM tracks WHERE id = ?').get(id) as Row | undefined;
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (Number(track.uploader_id) !== req.user!.id && req.user!.role !== 'admin' && req.user!.role !== 'owner') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (track.status !== 'rejected') return res.status(400).json({ error: 'Only rejected tracks can be resubmitted' });
  getDb()
    .prepare("UPDATE tracks SET status = 'pending', rejection_reason = NULL WHERE id = ?")
    .run(id);
  const updated = findTrack(req.user!.id, id)!;
  return res.json({ track: toTrack(updated, Boolean(updated.liked), Boolean(updated.reposted)) });
});

// DELETE /api/tracks/:id — uploader deletes own track, owner can delete any track
router.delete('/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const track = getDb().prepare('SELECT * FROM tracks WHERE id = ?').get(id) as Row | undefined;
  if (!track) return res.status(404).json({ error: 'Track not found' });
  if (Number(track.uploader_id) !== req.user!.id && req.user!.role !== 'owner') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const deletedByAdmin = req.user!.role === 'owner' && Number(track.uploader_id) !== req.user!.id;
  removeTrackFiles(track);
  getDb().prepare('DELETE FROM tracks WHERE id = ?').run(id);

  if (deletedByAdmin) {
    notify(Number(track.uploader_id), {
      type: 'track_deleted',
      trackId: id,
      trackTitle: String(track.title),
      message: `Your track "${track.title}" was deleted by a moderator`,
    });
  }
  return res.json({ ok: true });
});

export default router;
