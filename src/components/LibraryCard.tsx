import { Link } from 'react-router';
import { Play, Pause, Heart, Music2 } from 'lucide-react';
import { motion } from 'motion/react';
import LiveBars from './LiveBars';
import { formatTime } from '../lib/format';

interface LibraryCardProps {
  key?: string | number;
  trackId: number;
  cover: string | null;
  title: string;
  artist: string;
  duration: number;
  isLiked: boolean;
  isPlaying: boolean;
  href: string;
  onPlay: () => void;
  onLike: () => void;
}

// Reusable grid tile for the Library page: square cover with a hover play
// button (always visible while playing), a like toggle and the title/artist.
export default function LibraryCard({
  trackId,
  cover,
  title,
  artist,
  duration,
  isLiked,
  isPlaying,
  href,
  onPlay,
  onLike,
}: LibraryCardProps) {
  return (
    <div className="group relative flex flex-col gap-2.5">
      <Link to={href} className="relative block aspect-square overflow-hidden rounded-md bg-neutral-900">
        {cover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-neutral-900">
            <Music2 className="w-10 h-10 text-neutral-700" />
          </div>
        )}

        <div
          className={`absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity duration-150 ${
            isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <motion.button
            onClick={(e) => {
              e.preventDefault();
              onPlay();
            }}
            whileTap={{ scale: 0.88 }}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-neutral-100 text-neutral-950 shadow-xl"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            <span className="flex items-center justify-center w-5 h-5">
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current translate-x-px" />
              )}
            </span>
          </motion.button>
        </div>

        {isPlaying && (
          <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-full bg-black/70 px-2.5 py-1">
            <div className="relative w-6 h-3">
              <LiveBars trackId={trackId} barCount={7} />
            </div>
            <span className="text-[10px] font-medium text-neutral-200 tabular-nums">{formatTime(duration)}</span>
          </div>
        )}
      </Link>

      <div className="flex items-center gap-2.5 px-0.5">
        <motion.button
          onClick={onLike}
          whileTap={{ scale: 0.8 }}
          className="shrink-0"
          title={isLiked ? 'Unlike' : 'Like'}
        >
          <motion.span
            key={isLiked ? 'on' : 'off'}
            animate={isLiked ? { scale: [1, 1.3, 1] } : { scale: 1 }}
            transition={{ duration: 0.35 }}
            className="block"
          >
            <Heart
              className={`w-4 h-4 ${
                isLiked ? 'fill-neutral-100 text-neutral-100' : 'text-neutral-500 hover:text-neutral-100'
              }`}
            />
          </motion.span>
        </motion.button>

        <div className="min-w-0">
          <Link to={href} className="block">
            <h3 className="text-sm font-semibold text-neutral-100 truncate hover:underline">{title}</h3>
          </Link>
          <p className="text-xs text-neutral-500 truncate">{artist}</p>
        </div>
      </div>
    </div>
  );
}
