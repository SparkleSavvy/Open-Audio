import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { getDb, closeDb } from './db';
import { verifyToken } from './auth';
import { loadUser } from './middleware';
import { csrfGuard, rateLimit, resolveInside } from './security';
import authRoutes from './routes/auth';
import trackRoutes from './routes/tracks';
import uploadRoutes from './routes/upload';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';
import userRoutes from './routes/users';
import studioRoutes from './routes/studio';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
  app.use(
    helmet({
      // HSTS is only effective over HTTPS; behind a TLS-terminating proxy the
      // browser still sees a secure origin, so enable it in production.
      hsts: config.isProduction
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
      contentSecurityPolicy: config.enableCsp
        ? {
            directives: {
            defaultSrc: ["'self'"],
            // The production build emits external scripts only; 'unsafe-inline'
            // is needed solely by dev-mode HMR. Keep it strict in production.
            scriptSrc: ["'self'", ...(config.isProduction ? [] : ["'unsafe-inline'"])],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            mediaSrc: ["'self'", 'blob:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: null,
          },
        }
      : false,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: false }));
app.use(cookieParser());

// Global per-IP API limiter (generous; auth routes have stricter limits)
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.apiMax,
  message: 'Too many requests, please slow down',
});

getDb();

// Uploaded media files
const uploadRoot = path.resolve(config.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

// Express.static resolves `..` segments, so guard the request path against
// traversal before it can reach a file outside the uploads root. Audio and
// covers belonging to tracks awaiting moderation are served only to their
// uploader, moderators, and the owner.
function guardUploads(req: Request, res: Response, next: NextFunction) {
  let rel = req.path.replace(/^\/+/, '');
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return res.status(400).json({ error: 'Bad request' });
  }
  const abs = resolveInside(uploadRoot, rel);
  if (abs === null) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    if (fs.statSync(abs).isDirectory()) {
      return res.status(404).json({ error: 'Not found' });
    }
  } catch {
    // Missing/unreadable file — let express.static decide the 404.
  }
  if ((rel.startsWith('audio/') || rel.startsWith('covers/')) && !canViewTrackFile(req, rel)) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

function findTrackByFile(url: string) {
  return getDb()
    .prepare('SELECT id, uploader_id, status FROM tracks WHERE audio_url = ? OR cover_url = ?')
    .get(url, url) as { id: number; uploader_id: number; status: string } | undefined;
}

function loadViewer(req: Request) {
  const token = req.cookies?.token;
  const payload = token && typeof token === 'string' ? verifyToken(token) : null;
  return payload ? loadUser(payload.userId) : null;
}

function canViewTrackFile(req: Request, rel: string): boolean {
  const track = findTrackByFile(`/uploads/${rel}`);
  if (!track) return true;
  if (track.status === 'verified' || track.status === 'approved') return true;
  const viewer = loadViewer(req);
  if (!viewer || viewer.banned) return false;
  const isMod = viewer.role === 'admin' || viewer.role === 'owner';
  return isMod || Number(viewer.id) === Number(track.uploader_id);
}

app.use('/uploads', guardUploads, express.static(uploadRoot, { maxAge: '7d', fallthrough: false, index: false }));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

app.use('/api', apiLimiter);
// CSRF defense-in-depth for state-changing requests (see csrfGuard).
app.use('/api', csrfGuard);
app.use('/api/auth', authRoutes);
app.use('/api/tracks', trackRoutes);
app.use('/api', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/studio', studioRoutes);

// SPA fallback for production builds
const distDir = path.resolve('dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    return res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Multer errors carry static, non-sensitive messages; map by code and never
// echo a raw error message (fs failures can leak filesystem paths).
const MULTER_ERRORS: Record<string, string> = {
  LIMIT_FILE_SIZE: 'File is too large',
  LIMIT_FILE_COUNT: 'Too many files',
  LIMIT_FILE_EXTENSION: 'File type is not allowed',
  LIMIT_FIELD_COUNT: 'Too many form fields',
  LIMIT_FIELD_VALUE: 'Form field value is too long',
  LIMIT_FIELD_KEY: 'Form field name is too long',
  LIMIT_PART_COUNT: 'Too many form parts',
  LIMIT_UNEXPECTED_FILE: 'Unexpected form field',
};

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const nodeErr = err as { code?: string; status?: number; statusCode?: number; type?: string };
  if (nodeErr?.code === 'ENOENT' || nodeErr?.status === 404 || nodeErr?.statusCode === 404) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (nodeErr?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: MULTER_ERRORS[err.code] ?? 'Upload failed' });
  }
  console.error('[open-audio]', err);
  return res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(config.port, () => {
  console.log(`[open-audio] API ready on http://localhost:${config.port}`);
});

function shutdown() {
  server.close();
  closeDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
