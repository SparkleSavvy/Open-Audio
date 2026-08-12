import { Router } from 'express';
import { getDb } from '../db';
import { requireAuth } from '../middleware';
import { toNotification } from '../serialize';

const router = Router();

type Row = Record<string, any>;

// GET /api/notifications — current user's notifications
router.get('/', requireAuth, (req, res) => {
  const rows = getDb()
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 200')
    .all(req.user!.id) as Row[];
  return res.json({ notifications: rows.map(toNotification) });
});

// GET /api/notifications/unread-count
router.get('/unread-count', requireAuth, (req, res) => {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0')
    .get(req.user!.id) as { n: number };
  return res.json({ unread: Number(row.n) });
});

// DELETE /api/notifications — clear all notifications for the user
router.delete('/', requireAuth, (req, res) => {
  getDb().prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user!.id);
  return res.json({ ok: true });
});

// POST /api/notifications/:id/read
router.post('/:id/read', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?')
    .get(id, req.user!.id);
  if (!row) return res.status(404).json({ error: 'Notification not found' });
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  return res.json({ ok: true });
});

// POST /api/notifications/read-all
router.post('/read-all', requireAuth, (req, res) => {
  getDb().prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user!.id);
  return res.json({ ok: true });
});

export default router;
