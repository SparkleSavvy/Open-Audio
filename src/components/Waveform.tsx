import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePlayer } from '../lib/PlayerContext';
import { formatTime } from '../lib/format';
import { sampleLevels } from '../lib/audioSpectrum';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';

const BAR_COUNT = 360;
const PEAK_CACHE = new Map<string, Float32Array>();

// Bar geometry (CSS px, canvas draws in CSS px under the dpr transform).
const BAR_W = 3;
const BAR_GAP = 2;
const BAR_RADIUS = 1;

// Monochrome accent: played = full white, unplayed = dim gray on the plate.
const PLAYED_FILL = '#FFFFFF';
const UNPLAYED_FILL = 'rgba(255,255,255,0.16)';
const HOVER_LINE = 'rgba(255,255,255,0.35)';

async function decodePeaks(url: string): Promise<Float32Array> {
  const cached = PEAK_CACHE.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load audio');
  const buf = await res.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const audio = await ctx.decodeAudioData(buf);
  const data = audio.getChannelData(0);
  const peaks = new Float32Array(BAR_COUNT);
  const block = Math.max(Math.floor(data.length / BAR_COUNT), 1);
  for (let i = 0; i < BAR_COUNT; i++) {
    let max = 0;
    const start = i * block;
    for (let j = 0; j < block; j += 4) {
      const v = Math.abs(data[start + j] ?? 0);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  PEAK_CACHE.set(url, peaks);
  return peaks;
}

interface WaveformProps {
  trackId: number;
  audioUrl: string;
  duration: number;
  comments?: { ts: number; avatarUrl: string | null; username?: string }[];
  onSeek?: (time: number) => void;
}

export default function Waveform({ trackId, audioUrl, duration, comments = [], onSeek }: WaveformProps) {
  const { current, progress, isPlaying, audioElement } = usePlayer();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaksState, setPeaksState] = useState<{ url: string; data: Float32Array } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const reduced = usePrefersReducedMotion();

  const isCurrent = current?.id === trackId;
  const isLive = isCurrent && isPlaying && !reduced;
  const playedRatio = isCurrent && duration > 0 ? Math.min(progress / duration, 1) : 0;

  const playedRatioRef = useRef(playedRatio);
  const hoverRef = useRef(hover);
  useEffect(() => {
    playedRatioRef.current = playedRatio;
  }, [playedRatio]);
  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);

  const placeholder = useMemo(() => {
    const arr = new Float32Array(BAR_COUNT);
    let seed = ((trackId * 2654435761) >>> 0) || 1;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < BAR_COUNT; i++) arr[i] = 0.3 + 0.7 * rand();
    return arr;
  }, [trackId]);

  useEffect(() => {
    let cancelled = false;
    const cached = PEAK_CACHE.get(audioUrl);
    if (cached) {
      setPeaksState({ url: audioUrl, data: cached });
      return;
    }
    decodePeaks(audioUrl)
      .then((p) => {
        if (!cancelled) setPeaksState({ url: audioUrl, data: p });
      })
      .catch(() => {
        /* keep placeholder */
      });
    return () => {
      cancelled = true;
    };
  }, [audioUrl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setSize({ w: container.clientWidth, h: container.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const data = peaksState && peaksState.url === audioUrl ? peaksState.data : placeholder;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mid = size.h / 2;
    const maxAmp = Math.max(mid - 2, 1);
    const slot = BAR_W + BAR_GAP;
    const n = Math.max(Math.floor(size.w / slot), 1);

    let raf = 0;
    let lastKey = '';

    const draw = (live: boolean) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);

      const freq = live ? sampleLevels(audioElement ?? null) : null;

      const playedIdx = playedRatioRef.current * n;

      for (let i = 0; i < n; i++) {
        const src = Math.min(Math.floor(((i + 0.5) * data.length) / n), data.length - 1);
        const peak = Math.min(Math.max(data[src], 0.02), 1);
        let amp: number;
        if (live && freq) {
          const idx = Math.min(freq.length - 1, Math.floor((i / n) * freq.length * 0.85));
          const lv = Math.max(0, freq[idx] / 255);
          amp = peak * (0.55 + 0.45 * lv);
        } else {
          amp = peak;
        }
        const h = amp * maxAmp;
        const played = i <= playedIdx;
        ctx.fillStyle = played ? PLAYED_FILL : UNPLAYED_FILL;
        const x = i * slot + (slot - BAR_W) / 2;
        const y = mid - h;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_W, h * 2, BAR_RADIUS);
        ctx.fill();
      }

      const hv = hoverRef.current;
      if (hv != null && duration > 0) {
        const hx = (hv / duration) * size.w;
        ctx.fillStyle = HOVER_LINE;
        ctx.fillRect(hx, 0, 1, size.h);
      }
    };

    if (isLive) {
      const loop = () => {
        raf = requestAnimationFrame(loop);
        draw(true);
      };
      loop();
    } else {
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const key = `${playedRatioRef.current}|${hoverRef.current ?? ''}`;
        if (key === lastKey) return;
        lastKey = key;
        draw(false);
      };
      loop();
    }

    return () => cancelAnimationFrame(raf);
  }, [data, size, duration, isLive, audioElement]);

  const posFromEvent = (e: ReactPointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return null;
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    return ratio * duration;
  };

  const handleMove = (e: ReactPointerEvent) => {
    const t = posFromEvent(e);
    if (t == null) return;
    setHover(t);
    if (draggingRef.current) onSeek?.(t);
  };

  const currentLabelLeft = Math.min(Math.max(playedRatio * 100, 4), 96);

  return (
    <div className="w-full select-none touch-none">
      {/* Time labels: current position follows the playhead boundary, total duration pinned right */}
      <div className="relative mb-1.5 h-6">
        <span
          className="absolute -translate-x-1/2 text-xs font-semibold leading-none text-neutral-50 bg-neutral-950 border border-neutral-700/60 px-2 py-1 rounded-md tabular-nums pointer-events-none shadow-sm"
          style={{ left: `${currentLabelLeft}%` }}
        >
          {formatTime(isCurrent ? progress : 0)}
        </span>
        <span className="absolute right-0 text-xs font-semibold leading-none text-neutral-50 bg-neutral-950 border border-neutral-700/60 px-2 py-1 rounded-md tabular-nums pointer-events-none shadow-sm">
          {formatTime(duration)}
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative h-24 sm:h-32 w-full cursor-pointer rounded-xl bg-[#1E1E1E] border border-neutral-800/70 overflow-hidden"
        onPointerDown={(e) => {
          const t = posFromEvent(e);
          if (t == null) return;
          draggingRef.current = true;
          setHover(t);
          onSeek?.(t);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={handleMove}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        onPointerLeave={() => {
          if (!draggingRef.current) setHover(null);
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        {comments.map((c, i) => {
          if (duration <= 0) return null;
          const left = Math.min(Math.max((c.ts / duration) * 100, 3.5), 96.5);
          return (
            <button
              key={`${c.ts}-${i}`}
              type="button"
              className="absolute bottom-1 -translate-x-1/2 w-6 h-6 rounded-full border-2 border-neutral-950 bg-neutral-800 overflow-hidden hover:z-10"
              style={{ left: `${left}%` }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSeek?.(c.ts);
              }}
              title={`@${c.username ?? 'comment'} · ${formatTime(c.ts)}`}
            >
              {c.avatarUrl ? (
                <img src={c.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="flex items-center justify-center w-full h-full text-[8px] font-bold text-neutral-200 uppercase">
                  {(c.username ?? '?').slice(0, 1)}
                </span>
              )}
            </button>
          );
        })}
        {hover != null && duration > 0 && (
          <span
            className="absolute top-1.5 -translate-x-1/2 text-xs font-semibold leading-none text-neutral-50 bg-neutral-950 border border-neutral-700/60 px-2 py-1 rounded-md pointer-events-none z-10 tabular-nums shadow-sm"
            style={{ left: `${(hover / duration) * 100}%` }}
          >
            {formatTime(hover)}
          </span>
        )}
      </div>
    </div>
  );
}
