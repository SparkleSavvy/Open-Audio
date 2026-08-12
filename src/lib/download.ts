import type { Track, User } from '../types';

export function canDownload(track: Track, user: User | null): boolean {
  if (user?.role === 'owner') return true;
  return !(track.lossless && !user?.supporter);
}

export function downloadGateReason(track: Track, user: User | null): string | null {
  if (!track.lossless) return null;
  if (user?.role === 'owner') return null;
  if (!user) return 'Log in as a supporter to download lossless (FLAC) tracks';
  if (!user.supporter) return 'Only supporters can download lossless (FLAC) tracks';
  return null;
}
