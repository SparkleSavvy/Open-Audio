import type { DB } from './db';
import { toTrack, type ApiTrack } from './serialize';
import type { ParsedAudio } from './media';

export interface TrackFields {
  title: string;
  artist: string;
  description: string;
  genre: string | null;
  license: string;
  duration: number;
  source?: string | null;
  sourceUrl?: string | null;
}

export function insertTrackRow(
  db: DB,
  fields: TrackFields,
  audioUrl: string,
  coverUrl: string,
  meta: ParsedAudio,
  userId: number,
): number {
  const info = db
    .prepare(
      `INSERT INTO tracks (title, artist, description, cover_url, audio_url, duration, uploader_id, status, genre, license, bitrate, sample_rate, bit_depth, codec, container, lossless, source, source_url, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      fields.title,
      fields.artist,
      fields.description,
      coverUrl,
      audioUrl,
      fields.duration,
      userId,
      'pending',
      fields.genre,
      fields.license,
      meta.bitrate,
      meta.sampleRate,
      meta.bitsPerSample,
      meta.codec,
      meta.container,
      meta.lossless ? 1 : 0,
      fields.source ?? null,
      fields.sourceUrl ?? null,
      Date.now(),
    );
  return Number(info.lastInsertRowid);
}

export function buildTrackResponse(
  db: DB,
  trackId: number,
  uploader: { id: number; username: string; avatarUrl: string | null },
): ApiTrack {
  const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId) as Record<string, any>;
  const track = toTrack(row);
  track.uploader = { ...uploader };
  return track;
}
