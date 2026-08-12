export interface ApiUser {
  id: number;
  username: string;
  email: string | null;
  role: 'user' | 'admin' | 'owner';
  avatar_url: string | null;
  bio: string;
  banned: boolean;
  supporter: boolean;
  twoFactorEnabled: boolean;
  created_at: number;
}

export function toUser(row: Record<string, any>): ApiUser {
  return {
    id: Number(row.id),
    username: String(row.username),
    email: row.email ?? null,
    role: row.role,
    avatar_url: row.avatar_url ?? null,
    bio: row.bio ?? '',
    banned: Boolean(row.banned),
    supporter: Boolean(row.supporter),
    twoFactorEnabled: Boolean(row.totp_enabled),
    created_at: Number(row.created_at),
  };
}

export interface ApiTrack {
  id: number;
  title: string;
  artist: string;
  description: string;
  coverUrl: string | null;
  audioUrl: string;
  duration: number;
  status: 'pending' | 'verified' | 'suspended' | 'rejected' | 'approved';
  rejectionReason: string | null;
  genre: string | null;
  license: string;
  bitrate: number;
  sampleRate: number;
  bitDepth: number;
  codec: string | null;
  container: string | null;
  lossless: boolean;
  source: string | null;
  sourceUrl: string | null;
  plays: number;
  likes: number;
  reposts: number;
  liked: boolean;
  reposted: boolean;
  createdAt: number;
  uploader: { id: number; username: string; avatarUrl: string | null } | null;
}

export function toTrack(row: Record<string, any>, liked = false, reposted = false): ApiTrack {
  return {
    id: Number(row.id),
    title: String(row.title),
    artist: String(row.artist),
    description: String(row.description ?? ''),
    coverUrl: row.cover_url ?? null,
    audioUrl: String(row.audio_url),
    duration: Number(row.duration ?? 0),
    status: row.status ?? 'pending',
    rejectionReason: row.rejection_reason ?? null,
    genre: row.genre ?? null,
    license: String(row.license ?? 'all rights reserved'),
    bitrate: Number(row.bitrate ?? 0),
    sampleRate: Number(row.sample_rate ?? 0),
    bitDepth: Number(row.bit_depth ?? 0),
    codec: row.codec ?? null,
    container: row.container ?? null,
    lossless: Boolean(row.lossless),
    source: row.source ?? null,
    sourceUrl: row.source_url ?? null,
    plays: Number(row.plays ?? 0),
    likes: Number(row.likes ?? 0),
    reposts: Number(row.reposts ?? 0),
    liked,
    reposted,
    createdAt: Number(row.created_at),
    uploader:
      row.uploader_id != null
        ? {
            id: Number(row.uploader_id),
            username: String(row.uploader_username ?? 'Unknown'),
            avatarUrl: row.uploader_avatar ?? null,
          }
        : null,
  };
}

export interface ApiComment {
  id: number;
  trackId: number;
  ts: number;
  body: string;
  replyTo: number | null;
  createdAt: number;
  likes: number;
  liked: boolean;
  user: { id: number; username: string; avatarUrl: string | null };
}

export function toComment(row: Record<string, any>): ApiComment {
  return {
    id: Number(row.id),
    trackId: Number(row.track_id),
    ts: Number(row.ts ?? 0),
    body: String(row.body),
    replyTo: row.reply_to != null ? Number(row.reply_to) : null,
    createdAt: Number(row.created_at),
    likes: Number(row.likes ?? 0),
    liked: Boolean(row.liked),
    user: {
      id: Number(row.user_id),
      username: String(row.username ?? 'Unknown'),
      avatarUrl: row.avatar_url ?? null,
    },
  };
}

export type NotificationType =
  | 'track_verified'
  | 'track_rejected'
  | 'track_suspended'
  | 'track_unsuspended'
  | 'track_deleted'
  | 'track_comment'
  | 'admin_message';

export interface ApiNotification {
  id: number;
  type: NotificationType;
  trackId: number | null;
  trackTitle: string;
  message: string;
  read: boolean;
  createdAt: number;
}

export function toNotification(row: Record<string, any>): ApiNotification {
  return {
    id: Number(row.id),
    type: row.type,
    trackId: row.track_id != null ? Number(row.track_id) : null,
    trackTitle: String(row.track_title ?? ''),
    message: String(row.message),
    read: Boolean(row.read),
    createdAt: Number(row.created_at),
  };
}
