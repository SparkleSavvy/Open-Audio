import { Request, Response, Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config';
import { getDb } from '../db';
import { requireAuth } from '../middleware';
import { insertTrackRow, buildTrackResponse } from '../trackRepo';
import { assertAudioSignature, assertImageSignature } from '../security';
import { readAudioMeta, type ParsedAudio } from '../media';

const router = Router();

const AUDIO_DIR = path.resolve(config.uploadDir, 'audio');
const COVER_DIR = path.resolve(config.uploadDir, 'covers');
fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(COVER_DIR, { recursive: true });

// Canonical extension per accepted MIME type. Never derived from the client's
// original filename — that would let a polyglot file be stored as e.g.
// `uuid.html` and served same-origin as text/html (stored XSS).
const EXT_BY_MIME: Record<string, string> = {
  'audio/ogg': '.ogg',
  'audio/opus': '.ogg',
  'audio/webm': '.webm',
  'video/webm': '.webm',
  'audio/flac': '.flac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/x-m4a': '.m4a',
  'audio/mp4': '.m4a',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination(_req, file, cb) {
    cb(null, file.fieldname === 'cover' ? COVER_DIR : AUDIO_DIR);
  },
  filename(_req, file, cb) {
    const ext = EXT_BY_MIME[file.mimetype] ?? '.bin';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

// Errors raised by our own fileFilter are safe to show to the client; anything
// else (disk write failures, OS errors with filesystem paths) must be generic.
function safeError(message: string) {
  return Object.assign(new Error(message), { safeMessage: true });
}

const upload = multer({
  storage,
  limits: {
    fileSize: 60 * 1024 * 1024,
    files: 2,
    // Guard against multipart field floods: a few text fields are expected
    // (title, artist, description, genre, license, duration).
    fields: 30,
    fieldSize: 64 * 1024,
    parts: 40,
  },
  fileFilter(_req, file, cb) {
    const callback = cb as unknown as (err: Error | null, accept?: boolean) => void;
    if (file.fieldname === 'cover') {
      const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
      if (ok) return callback(null, true);
      return callback(safeError('Unsupported cover format'), false);
    }
    if (file.fieldname === 'audio') {
      const ok =
        ['audio/ogg', 'audio/opus', 'audio/webm', 'video/webm', 'audio/flac', 'audio/wav', 'audio/x-wav', 'audio/x-m4a', 'audio/mp4'].includes(
          file.mimetype,
        ) || /\.(opus|ogg|webm|flac|wav|alac|m4a)$/i.test(file.originalname);
      if (ok) return callback(null, true);
      return callback(safeError('Unsupported audio format'), false);
    }
    return callback(safeError('Unexpected field'), false);
  },
});

function uploadedFiles(req: Request): Express.Multer.File[] {
  const files = (req as { files?: unknown }).files;
  if (Array.isArray(files)) return files;
  if (files && typeof files === 'object') {
    return Object.values(files as Record<string, Express.Multer.File[]>).flat();
  }
  return [];
}

function cleanup(req: Request) {
  for (const f of uploadedFiles(req)) {
    try {
      fs.unlinkSync(f.path);
    } catch {
      /* already gone */
    }
  }
}

function readHeader(filePath: string, size: number): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(size);
    const read = fs.readSync(fd, buf, 0, size, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function extractTrackFields(body: Record<string, unknown>) {
  const str = (key: string) => (typeof body[key] === 'string' ? body[key].trim() : '');
  return {
    title: str('title'),
    artist: str('artist'),
    description: str('description'),
    genre: str('genre').slice(0, 60),
    license: str('license').slice(0, 120),
    duration: Math.max(0, Math.round(Number(body.duration) || 0)),
  };
}

function codecSupportError(meta: ParsedAudio): string | null {
  const codec = (meta.codec ?? '').toLowerCase();
  const container = (meta.container ?? '').toLowerCase();
  const isOpus = codec === 'opus' && /(ogg|webm|matroska|ebml)/.test(container);
  const isAac = codec === 'aac' && /(mp4|m4a|iso)/.test(container);
  if (isOpus || isAac || meta.lossless) return null;
  return `Unsupported format${meta.codec ? ` (${meta.codec})` : ''} — only Opus (Ogg/WebM), AAC (M4A) and lossless audio (FLAC/WAV/ALAC) are supported`;
}

// Cleans up the uploaded files and sends an error response.
function fail(req: Request, res: Response, status: number, message: string) {
  cleanup(req);
  return res.status(status).json({ error: message });
}

function fileSignatureError(files: { audio?: Express.Multer.File; cover?: Express.Multer.File }): string | null {
  if (files.audio && !assertAudioSignature(readHeader(files.audio.path, 16))) {
    return 'Audio file content does not match a supported format';
  }
  if (files.cover && !assertImageSignature(readHeader(files.cover.path, 16), files.cover.mimetype)) {
    return 'Cover image content does not match a supported image format';
  }
  return null;
}

function trackFieldsError(finalTitle: string, finalArtist: string): string | null {
  if (!finalTitle) return 'Track title is required';
  if (finalTitle.length > 120) return 'Title must be 120 characters or fewer';
  if (!finalArtist) return 'Artist name is required';
  if (finalArtist.length > 120) return 'Artist must be 120 characters or fewer';
  return null;
}

function resolveFinalFields(fields: ReturnType<typeof extractTrackFields>, meta: ParsedAudio) {
  return {
    title: (fields.title || meta.title || '').trim(),
    artist: (fields.artist || meta.artist || '').trim(),
    duration: meta.duration || fields.duration,
  };
}

function resolveCoverUrl(cover: Express.Multer.File | undefined, meta: ParsedAudio): string | null {
  return cover ? `/uploads/covers/${path.basename(cover.filename)}` : meta.cover;
}

async function handleTrackUpload(req: Request, res: Response) {
  const files = uploadedFiles(req);
  const audio = files.find((f) => f.fieldname === 'audio');
  const cover = files.find((f) => f.fieldname === 'cover');
  const body = (req.body ?? {}) as Record<string, unknown>;

  const signatureError = fileSignatureError({ audio, cover });
  if (signatureError) return fail(req, res, 400, signatureError);
  if (!audio) {
    return fail(req, res, 400, 'Audio file is required');
  }

  const meta = await readAudioMeta(audio.path);
  if (!meta) {
    return fail(req, res, 400, 'Could not read audio file — use Opus (Ogg/WebM), AAC (M4A) or a lossless format (FLAC/WAV/ALAC)');
  }

  const unsupported = codecSupportError(meta);
  if (unsupported) return fail(req, res, 400, unsupported);

  const fields = extractTrackFields(body);
  const final = resolveFinalFields(fields, meta);
  const fieldsError = trackFieldsError(final.title, final.artist);
  if (fieldsError) return fail(req, res, 400, fieldsError);

  const coverUrl = resolveCoverUrl(cover, meta);
  if (!coverUrl) {
    return fail(req, res, 400, 'A cover image is required — attach one or embed it in the audio file');
  }

  const db = getDb();
  const trackId = insertTrackRow(
    db,
    {
      title: final.title,
      artist: final.artist,
      description: fields.description,
      genre: fields.genre || null,
      license: fields.license || 'all rights reserved',
      duration: final.duration,
    },
    `/uploads/audio/${path.basename(audio.filename)}`,
    coverUrl,
    meta,
    req.user!.id,
  );
  const track = buildTrackResponse(db, trackId, {
    id: req.user!.id,
    username: req.user!.username,
    avatarUrl: req.user!.avatar_url ?? null,
  });
  return res.status(201).json({ track });
}

router.post(
  '/tracks',
  requireAuth,
  (req, res) => {
    upload.fields([
      { name: 'audio', maxCount: 1 },
      { name: 'cover', maxCount: 1 },
    ])(req, res, async (err) => {
      if (err) {
        const message =
          err instanceof multer.MulterError
            ? 'Upload too large or invalid'
            : (err as { safeMessage?: boolean }).safeMessage
              ? err.message
              : 'Upload failed';
        return fail(req, res, 400, message);
      }
      try {
        await handleTrackUpload(req, res);
      } catch (e) {
        cleanup(req);
        console.error('Upload error', e);
        return res.status(500).json({ error: 'Upload failed' });
      }
    });
  },
);

export default router;
