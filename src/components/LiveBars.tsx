import { useEffect, useRef, type RefObject } from 'react';
import { usePlayer } from '../lib/PlayerContext';
import { sampleLevels } from '../lib/audioSpectrum';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';

interface LiveBarsProps {
  trackId: number;
  barCount?: number;
  className?: string;
}

const FILL = '#f5f5f5';

// Index into the (log-weighted) frequency bins for a given bar.
function freqIndex(binCount: number, bar: number, barCount: number): number {
  return Math.min(binCount - 1, Math.floor((bar / barCount) * binCount * 0.85));
}

// Gentle idle wave used when no live analyser data is available.
function idleAmp(bar: number, barCount: number, t: number): number {
  const w1 = Math.sin(bar * 0.6 + t * 1.6) * 0.5 + 0.5;
  const w2 = Math.sin(bar * 1.3 - t * 0.9 + 1.7) * 0.5 + 0.5;
  return 0.16 + 0.1 * w1 + 0.08 * w2;
}

function drawBars(
  g: CanvasRenderingContext2D,
  opts: { width: number; height: number; barCount: number; freq: Uint8Array | null; t: number },
) {
  const { width, height, barCount, freq, t } = opts;
  const mid = height / 2;
  const slot = width / barCount;
  const gap = Math.max(Math.floor(slot * 0.2), 1);
  const barW = Math.max(slot - gap, 1);
  g.clearRect(0, 0, width, height);
  g.fillStyle = FILL;

  for (let i = 0; i < barCount; i++) {
    const amp = freq ? Math.max(0.05, freq[freqIndex(freq.length, i, barCount)] / 255) : idleAmp(i, barCount, t);
    const h = Math.max(1.5, amp * (height / 2));
    g.fillRect(i * slot + gap / 2, mid - h, barW, h * 2);
  }
}

// Runs a canvas paint loop: sizes the canvas to its parent (with DPR), redraws
// on resize, and keeps a requestAnimationFrame loop running. With reduced
// motion enabled it paints a single frame instead of animating.
function useCanvasAnimation(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  reduced: boolean,
  onFrame: (g: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth : canvas.clientWidth;
      const h = parent ? parent.clientHeight : canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
    };
    resize();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      ro = new ResizeObserver(resize);
      ro.observe(canvas.parentElement);
    }

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      if (width === 0 || height === 0) return;
      onFrameRef.current(g, width, height);
    };

    if (reduced) {
      draw();
    } else {
      const loop = () => {
        raf = requestAnimationFrame(loop);
        draw();
      };
      loop();
    }

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [canvasRef, reduced]);
}

export default function LiveBars({ trackId, barCount = 24, className }: LiveBarsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { current, isPlaying, audioElement } = usePlayer();
  const reduced = usePrefersReducedMotion();
  const isActive = current?.id === trackId && isPlaying && !reduced;
  const tRef = useRef(0);

  useCanvasAnimation(canvasRef, reduced, (g, width, height) => {
    const freq = isActive ? sampleLevels(audioElement ?? null) : null;
    tRef.current += 0.02;
    drawBars(g, { width, height, barCount, freq, t: tRef.current });
  });

  return <canvas ref={canvasRef} className={className ?? 'w-full h-full'} />;
}
