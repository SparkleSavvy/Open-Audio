import type { QualityTier } from '../types';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Always renders three parts: sample rate / bit depth / bitrate, with `—` for
// anything that is unknown.
export function formatQuality(sampleRate: number, bitDepth: number, bitrate: number): string {
  const rate = sampleRate > 0 ? `${(sampleRate / 1000).toFixed(1).replace(/\.0$/, '')} kHz` : '—';
  const depth = bitDepth > 0 ? `${bitDepth} bit` : '—';
  const br = bitrate > 0 ? `${Math.round(bitrate / 1000)} kbps` : '—';
  return `${rate} / ${depth} / ${br}`;
}

// True when the sample rate is unknown (0) or falls within the given range.
// Unknown rates are accepted so lossless files missing metadata still tier up.
function sampleRateIn(rate: number, min: number, max?: number): boolean {
  if (rate === 0) return true;
  if (rate < min) return false;
  return max === undefined || rate <= max;
}

// Quality category based on the file's codec and sample properties.
//   Hi-Res : lossless, 24-bit, 44.1–192 kHz
//   Hi-Fi  : lossless, 16-bit, >= 44.1 kHz (CD quality)
//   Standard / HQ : everything else (Opus/AAC/MP3, up to 320 kbps)
export function qualityTier(track: {
  lossless: boolean;
  bitDepth: number;
  sampleRate: number;
}): QualityTier {
  if (track.lossless && track.bitDepth >= 24 && sampleRateIn(track.sampleRate, 44100, 192000)) {
    return 'hires';
  }
  if (track.lossless && track.bitDepth === 16 && sampleRateIn(track.sampleRate, 44100)) {
    return 'hifi';
  }
  return 'standard';
}

export const QUALITY_TIER_LABEL: Record<QualityTier, string> = {
  standard: 'Standard / HQ',
  hifi: 'Hi-Fi / CD Quality',
  hires: 'Hi-Res',
};
