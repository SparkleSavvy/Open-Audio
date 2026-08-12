import { Link } from 'react-router';
import { Play, Pause, Heart, Music2 } from 'lucide-react';
import { motion } from 'motion/react';
import { formatTime } from '../lib/format';

interface LibraryRowProps {
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

// Reusable list row for the Library page: small cover with a hover play
// button, title/artist, duration and a like toggle.
export default function LibraryRow({
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
}: LibraryRowProps) {
  return (
    <div className="group flex items-center gap-4 px-3 py-2.5 rounded-lg transition-colors hover:bg-neutral-900">
      <Link to={href} className="relative block w-12 h-12 shrink-0 overflow-hidden rounded-md bg-neutral-900">
        {cover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-neutral-900">
            <Music2 className="w-5 h-5 text-neutral-700" />
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
            className="w-7 h-7 flex items-center justify-center rounded-full bg-neutral-100 text-neutral-950 shadow-lg"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current translate-x-px" />
            )}
          </motion.button>
        </div>
      </Link>

      <Link to={href} className="flex-1 min-w-0">
        <p
          className={`text-sm truncate ${
            isPlaying ? 'text-neutral-100 font-medium' : 'text-neutral-200 hover:underline'
          }`}
        >
          {title}
        </p>
        <p className="text-xs text-neutral-500 truncate">{artist}</p>
      </Link>

      <span className="text-xs text-neutral-500 tabular-nums shrink-0">{formatTime(duration)}</span>

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
    </div>
  );
}
