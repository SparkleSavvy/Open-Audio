export type TrackStatus = 'pending' | 'verified' | 'suspended' | 'rejected' | 'approved';
export type Role = 'user' | 'admin' | 'owner';
export type QualityTier = 'standard' | 'hifi' | 'hires';

export type NotificationType =
  | 'track_verified'
  | 'track_rejected'
  | 'track_suspended'
  | 'track_unsuspended'
  | 'track_deleted'
  | 'track_comment'
  | 'admin_message';

export interface AppNotification {
  id: number;
  type: NotificationType;
  trackId: number | null;
  trackTitle: string;
  message: string;
  read: boolean;
  createdAt: number;
}

export interface User {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  avatar_url: string | null;
  bio: string;
  banned: boolean;
  supporter: boolean;
  twoFactorEnabled: boolean;
  created_at: number;
}

export interface TrackUploader {
  id: number;
  username: string;
  avatarUrl: string | null;
}

export interface Track {
  id: number;
  title: string;
  artist: string;
  description: string;
  coverUrl: string | null;
  audioUrl: string;
  duration: number;
  status: TrackStatus;
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
  uploader: TrackUploader | null;
}

export interface Comment {
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

export interface Fan {
  user: { id: number; username: string; avatarUrl: string | null };
  plays: number;
}

export interface UserProfile {
  id: number;
  username: string;
  avatar_url: string | null;
  bio: string;
  location: string;
  created_at: number;
  followers: number;
  following: number;
  trackCount: number;
  isFollowing: boolean;
  supporter: boolean;
}

export interface FollowedUser {
  user: { id: number; username: string; avatarUrl: string | null };
  location: string;
  followers: number;
  isFollowing: boolean;
}

export interface AdminStats {
  overview: {
    totalTracks: number;
    pendingTracks: number;
    verifiedTracks: number;
    suspendedTracks: number;
    rejectedTracks: number;
    totalUsers: number;
    bannedUsers: number;
    totalPlays: number;
    totalLikes: number;
  };
  recentUploads: { day: string; count: number }[];
  topTracks: {
    id: number;
    title: string;
    artist: string;
    plays: number;
    likes: number;
    coverUrl: string | null;
  }[];
}

export interface AdminUser extends User {
  trackCount: number;
}

export interface RemovalRequest {
  id: number;
  requestId: string;
  server: string;
  reason: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  requestedAt: number;
  confirmedAt: number | null;
  cancelledAt: number | null;
}

export interface TwoFaSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
  recoveryCodes: string[];
}

export interface TrackDeleteRequest {
  id: number;
  trackId: number;
  trackTitle: string;
  trackArtist: string;
  trackUploaderId: number | null;
  requestedBy: number;
  requestedByUsername: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  decidedAt: number | null;
  decidedBy: number | null;
  decidedByUsername: string | null;
}
