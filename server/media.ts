import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseFile, type IAudioMetadata } from 'music-metadata';
import { config } from './config';

export interface ParsedAudio {
  title: string;
  artist: string;
  duration: number;
  bitrate: number;
  sampleRate: number;
  bitsPerSample: number;
  codec: string | null;
  container: string | null;
  lossless: boolean;
  cover: string | null;
}

function sanitizeText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function coverExt(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'jpg';
}

// music-metadata's matroska loader advertises '.mka'/'.mkv'/'.mk3d'/'.mks'
// but lists 'webm' without the leading dot, so '.webm' never matches by
// extension and the MIME hint is ignored. Parse a '.mka' alias instead.
async function parseMetaFile(audioPath: string): Promise<IAudioMetadata> {
  if (path.extname(audioPath).toLowerCase() !== '.webm') {
    return parseFile(audioPath);
  }
  const tmp = `${audioPath}.mka`;
  try {
    fs.linkSync(audioPath, tmp);
  } catch {
    fs.copyFileSync(audioPath, tmp);
  }
  try {
    return await parseFile(tmp);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* already gone */
    }
  }
}

// Reads audio metadata plus any embedded cover (saved to the covers dir).
// Returns null when the file is not parseable as audio.
export async function readAudioMeta(audioPath: string): Promise<ParsedAudio | null> {
  let meta: IAudioMetadata;
  try {
    meta = await parseMetaFile(audioPath);
  } catch {
    return null;
  }

  const result: ParsedAudio = {
    title: sanitizeText(meta.common.title ?? '', 120),
    artist: sanitizeText(meta.common.artist ?? '', 120),
    duration: Math.max(0, Math.round(meta.format.duration ?? 0)),
    bitrate: Math.max(0, Math.round(meta.format.bitrate ?? 0)),
    sampleRate: Math.max(0, Math.round(meta.format.sampleRate ?? 0)),
    bitsPerSample: Math.max(0, Math.round(meta.format.bitsPerSample ?? 0)),
    codec: meta.format.codec ? String(meta.format.codec) : null,
    container: meta.format.container ? String(meta.format.container) : null,
    lossless: Boolean(meta.format.lossless),
    cover: null,
  };

  const picture = meta.common.picture?.[0];
  // Cap the embedded cover size so a large picture in the audio tags can't
  // be used to amplify disk writes on upload.
  if (picture?.data && picture.data.length > 0 && picture.data.length <= 5 * 1024 * 1024) {
    const ext = coverExt((picture.format || '').toLowerCase());
    const fname = `${crypto.randomUUID()}.${ext}`;
    const dir = path.resolve(config.uploadDir, 'covers');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fname), picture.data);
    result.cover = `/uploads/covers/${fname}`;
  }
  return result;
}
