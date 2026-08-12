import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Download,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { usePlayer } from '../lib/PlayerContext';
import { api, downloadTrack } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { formatTime } from '../lib/format';
import { canDownload, downloadGateReason } from '../lib/download';

export default function Player() {
  const { user } = useAuth();
  const {
    current,
    isPlaying,
    direction,
    progress,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    togglePlay,
    next,
    prev,
    toggleShuffle,
    cycleRepeat,
    seek,
    setVolume,
    toggleMute,
  } = usePlayer();
  const [liked, setLiked] = useState(false);
  const currentIdRef = useRef<number | null>(null);
  useEffect(() => {
    currentIdRef.current = current?.id ?? null;
  }, [current]);

  useEffect(() => {
    setLiked(Boolean(current?.liked));
  }, [current]);

  const toggleLike = async () => {
    if (!user || !current) return;
    const id = current.id;
    try {
      const res = await api.toggleLike(id);
      if (currentIdRef.current === id) setLiked(res.liked);
    } catch {
      /* ignore */
    }
  };

  if (!current) return null;

  const trackProgress = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-24 bg-neutral-950 border-t border-neutral-900 px-4 sm:px-6 flex items-center justify-between z-50 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
      {/* Track info */}
      <div className="flex items-center gap-4 w-1/3 min-w-[180px] max-w-[300px] overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={current.id}
            layout
            className="flex items-center gap-4 min-w-0"
            initial={{ opacity: 0, x: direction > 0 ? 32 : -32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction > 0 ? -32 : 32 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="relative shrink-0">
              <img
                src={current.coverUrl ?? '/fallback.svg'}
                alt={current.title}
                className="w-14 h-14 rounded-sm object-cover bg-neutral-900"
              />
              <div className="absolute inset-0 rounded-sm ring-1 ring-inset ring-white/5" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-neutral-100 truncate">{current.title}</span>
              <span className="text-xs text-neutral-500 truncate">{current.artist}</span>
            </div>
            <motion.button
              onClick={toggleLike}
              disabled={!user}
              whileTap={{ scale: 0.8 }}
              className={`shrink-0 disabled:opacity-40 ${
                liked ? 'text-neutral-100' : 'text-neutral-500 hover:text-neutral-100'
              }`}
              title={liked ? 'Unlike' : 'Like'}
            >
              <motion.span
                key={liked ? 'on' : 'off'}
                animate={liked ? { scale: [1, 1.35, 1] } : { scale: 1 }}
                transition={{ duration: 0.35 }}
                className="block"
              >
                <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
              </motion.span>
            </motion.button>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Controls */}
        <div className="flex flex-col items-center max-w-2xl w-full px-4 gap-1.5">
          <div className="flex items-center gap-5">
            <button
              onClick={toggleShuffle}
              className={`press ${
                shuffle ? 'text-neutral-100' : 'text-neutral-500 hover:text-neutral-100'
              }`}
              title={shuffle ? 'Shuffle: on' : 'Shuffle: off'}
            >
              <Shuffle className="w-5 h-5" />
            </button>
            <button onClick={prev} className="press text-neutral-400 hover:text-neutral-100">
              <SkipBack className="w-5 h-5 fill-current" />
            </button>
            <motion.button
              onClick={togglePlay}
              whileTap={{ scale: 0.88 }}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-neutral-100 text-neutral-950"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-1" />
              )}
            </motion.button>
            <button onClick={next} className="press text-neutral-400 hover:text-neutral-100">
              <SkipForward className="w-5 h-5 fill-current" />
            </button>
            <button
              onClick={cycleRepeat}
              className={`press ${
                repeat !== 'off' ? 'text-neutral-100' : 'text-neutral-500 hover:text-neutral-100'
              }`}
              title={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}
            >
              {repeat === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
            </button>
          </div>

          <div className="flex items-center w-full gap-3 text-[11px] text-neutral-500 font-medium">
          <span className="w-9 text-right tabular-nums">{formatTime(progress)}</span>
          <div className="relative flex-1 h-1.5 group flex items-center cursor-pointer">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={progress}
              onChange={(e: ChangeEvent<HTMLInputElement>) => seek(Number(e.target.value))}
              className="absolute w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-neutral-100 transition-[width] duration-100 ease-linear"
                style={{ width: `${trackProgress}%` }}
              />
            </div>
            <div
              className="absolute w-3 h-3 bg-neutral-100 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow pointer-events-none"
              style={{ left: `calc(${trackProgress}% - 6px)` }}
            />
          </div>
          <span className="w-9 text-left tabular-nums">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center justify-end gap-3 w-1/3 min-w-[180px] max-w-[340px]">
        <button
          onClick={() => current && downloadTrack(current)}
          disabled={!current || !canDownload(current, user)}
          className="press hidden sm:flex items-center gap-2 text-xs font-medium text-neutral-400 hover:text-neutral-100 bg-neutral-900 hover:bg-neutral-800 px-3 py-1.5 rounded-full border border-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-neutral-900 disabled:hover:text-neutral-400"
          title={current ? downloadGateReason(current, user) ?? 'Download track' : 'Download track'}
        >
          <Download className="w-4 h-4" />
          Download
        </button>

        <div className="flex items-center gap-2">
          <button onClick={toggleMute} className="press text-neutral-400 hover:text-neutral-100">
            {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <div className="w-16 sm:w-20 h-1.5 relative flex items-center">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setVolume(Number(e.target.value))}
              className="absolute w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-neutral-400 group-hover:bg-neutral-100 transition-colors"
                style={{ width: `${(muted ? 0 : volume) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
