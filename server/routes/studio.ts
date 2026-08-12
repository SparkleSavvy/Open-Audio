import { Request, Response, Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config';
import { getDb } from '../db';
import { requireAuth } from '../middleware';
import { rateLimit, assertAudioSignature } from '../security';
import { insertTrackRow, buildTrackResponse } from '../trackRepo';
import { readAudioMeta } from '../media';

const router = Router();

const AUDIO_DIR = path.resolve(config.uploadDir, 'audio');
const COVER_DIR = path.resolve(config.uploadDir, 'covers');
fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(COVER_DIR, { recursive: true });

const ALLOWED_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com']);
const MAX_BYTES = config.studioImportMaxBytes;
// One active import per user — prevents runaway downloads and double-submits.
const importing = new Set<number>();

const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many imports — please wait a while',
  keyFn: (req) => (req.user ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`),
});

interface YtDlpResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runYtDlp(args: string[]): Promise<YtDlpResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ytdlpPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 4 * 1024 * 1024) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 256 * 1024) {
        stderr = stderr.slice(-256 * 1024);
      }
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), config.ytdlpTimeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function validateSoundCloudUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
  const p = url.pathname.toLowerCase();
  if (p.includes('/sets/') || p.includes('/playlists/')) return null;
  return url;
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

function coverExtFromSignature(buf: Buffer): string | null {
  const sniff = (b: Buffer, ...sig: number[]) =>
    sig.every((byte, i) => b.length > i && b[i] === byte);
  if (sniff(buf, 0xff, 0xd8)) return 'jpg';
  if (sniff(buf, 0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (sniff(buf, 0x52, 0x49, 0x46, 0x46) && buf.length > 11 && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

// Copies the downloaded thumbnail (already validated) into the covers dir and
// returns its public URL, or null when there is nothing usable.
function persistThumbnail(thumbPath: string): string | null {
  const buf = readHeader(thumbPath, 12);
  const ext = coverExtFromSignature(buf);
  if (!ext) return null;
  const fname = `${crypto.randomUUID()}.${ext}`;
  const dest = path.join(COVER_DIR, fname);
  fs.copyFileSync(thumbPath, dest);
  return `/uploads/covers/${fname}`;
}

function rmrf(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

async function handleImport(req: Request, res: Response) {
  const userId = req.user!.id;
  if (importing.has(userId)) {
    return res.status(409).json({ error: 'An import is already in progress — wait for it to finish' });
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const url = validateSoundCloudUrl(typeof body.url === 'string' ? body.url : '');
  if (!url) {
    return res
      .status(400)
      .json({ error: 'Enter a valid SoundCloud track URL (playlists and sets are not supported)' });
  }

  importing.add(userId);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sparkle-import-'));
  try {
    const infoRun = await runYtDlp([
      '--dump-json',
      '--no-playlist',
      '--skip-download',
      '--no-warnings',
      '--no-cookies-from-browser',
      url.href,
    ]);
    if (infoRun.code !== 0) {
      console.error('[open-audio] yt-dlp metadata failed', infoRun.stderr.slice(0, 500));
      return res
        .status(422)
        .json({ error: 'Could not fetch this SoundCloud track — it may be unavailable or private' });
    }
    let info: { title?: string; uploader?: string; duration?: number; webpage_url?: string };
    try {
      info = JSON.parse(infoRun.stdout);
    } catch {
      console.error('[open-audio] yt-dlp JSON parse failed', infoRun.stdout.slice(0, 500));
      return res.status(422).json({ error: 'Could not fetch this SoundCloud track — try again' });
    }

    const dlRun = await runYtDlp([
      '--no-playlist',
      '--no-progress',
      '--no-warnings',
      '--no-cookies-from-browser',
      '-f',
      'bestaudio[ext=m4a]/bestaudio',
      '--write-thumbnail',
      '-o',
      path.join(tmpDir, 'track.%(ext)s'),
      url.href,
    ]);
    if (dlRun.code !== 0) {
      console.error('[open-audio] yt-dlp download failed', dlRun.stderr.slice(0, 500));
      return res
        .status(422)
        .json({ error: 'Could not download this SoundCloud track — it may be unavailable or private' });
    }

    const audioPath = ['.m4a', '.mp4']
      .map((ext) => path.join(tmpDir, `track${ext}`))
      .find((p) => fs.existsSync(p));
    if (!audioPath) {
      console.error('[open-audio] yt-dlp produced no audio file in', tmpDir);
      return res
        .status(422)
        .json({ error: 'SoundCloud returned an unsupported format — try a different track' });
    }

    const size = fs.statSync(audioPath).size;
    if (size > MAX_BYTES) {
      return res.status(413).json({ error: 'Imported file exceeds the 60 MB limit' });
    }
    if (!assertAudioSignature(readHeader(audioPath, 16))) {
      return res.status(422).json({ error: 'Downloaded file does not look like valid audio' });
    }

    const meta = await readAudioMeta(audioPath);
    if (!meta) {
      return res.status(422).json({ error: 'Could not read the downloaded audio file' });
    }

    // Prefer embedded cover art (already extracted to the covers dir by
    // readAudioMeta); fall back to the yt-dlp thumbnail.
    let coverUrl = meta.cover;
    if (!coverUrl) {
      const thumbs = fs.readdirSync(tmpDir).filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
      for (const t of thumbs) {
        const persisted = persistThumbnail(path.join(tmpDir, t));
        if (persisted) {
          coverUrl = persisted;
          break;
        }
      }
    }
    if (!coverUrl) {
      return res.status(422).json({ error: 'No cover image was found for this track' });
    }

    const storedName = `${crypto.randomUUID()}.m4a`;
    const audioDest = path.join(AUDIO_DIR, storedName);
    fs.copyFileSync(audioPath, audioDest);

    const title = (info.title ?? meta.title ?? '').trim().slice(0, 120) || 'Untitled';
    const artist = (info.uploader ?? meta.artist ?? '').trim().slice(0, 120) || 'Unknown';

    const db = getDb();
    const trackId = insertTrackRow(
      db,
      {
        title,
        artist,
        description: '',
        genre: null,
        license: 'all rights reserved',
        duration: meta.duration,
        source: 'soundcloud',
        sourceUrl: info.webpage_url ?? url.href,
      },
      `/uploads/audio/${storedName}`,
      coverUrl,
      meta,
      userId,
    );
    const track = buildTrackResponse(db, trackId, {
      id: userId,
      username: req.user!.username,
      avatarUrl: req.user!.avatar_url ?? null,
    });
    return res.status(201).json({ track });
  } finally {
    importing.delete(userId);
    rmrf(tmpDir);
  }
}

router.post('/import', importLimiter, requireAuth, async (req: Request, res: Response) => {
  try {
    await handleImport(req, res);
  } catch (e) {
    console.error('Import error', e);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Import failed' });
    }
  }
});

export default router;
