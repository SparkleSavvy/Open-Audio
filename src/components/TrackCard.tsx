import { Link } from 'react-router';
import { Play, Pause, Download, Heart, Music2, CloudDownload } from 'lucide-react';
import { motion } from 'motion/react';
import type { Track } from '../types';
import { usePlayer } from '../lib/PlayerContext';
import { downloadTrack } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { canDownload, downloadGateReason } from '../lib/download';
import { formatCount, formatTime } from '../lib/format';
import TrackMark from './TrackMark';
import LiveBars from './LiveBars';

interface TrackCardProps {
  key?: string | number;
  track: Track;
  index?: number;
}

export default function TrackCard({ track }: TrackCardProps) {
  const { user } = useAuth();
  const { current, isPlaying, playTrack } = usePlayer();
  const isCurrent = current?.id === track.id;
  const isCurrentPlaying = isCurrent && isPlaying;
  const suspended = track.status === 'suspended';

  return (
    <div className="group relative flex flex-col gap-3">
      <Link to={`/track/${track.id}`} className="relative aspect-square overflow-hidden bg-neutral-900 rounded-sm block">
        {track.coverUrl ? (
          <img
            src={track.coverUrl}
            alt={track.title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-neutral-900">
            <Music2 className="w-12 h-12 text-neutral-700" />
          </div>
        )}

        <div
          className={`absolute inset-0 bg-black/45 transition-opacity duration-150 ${
            isCurrent
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
          }`}
        >
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <button
              onClick={(e) => {
                e.preventDefault();
                downloadTrack(track);
              }}
              disabled={suspended || !canDownload(track, user)}
              className="press w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-neutral-200 hover:text-neutral-100 hover:bg-black/70 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-black/50"
              title={suspended ? 'Playback suspended' : downloadGateReason(track, user) ?? 'Download'}
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            {suspended ? (
              <div
                className="w-14 h-14 rounded-full bg-neutral-900/80 border border-neutral-700 flex items-center justify-center cursor-not-allowed"
                title="Playback suspended"
              >
                <Play className="w-6 h-6 fill-current text-neutral-600" />
              </div>
            ) : (
              <motion.button
                onClick={(e) => {
                  e.preventDefault();
                  playTrack(track);
                }}
                whileTap={{ scale: 0.88 }}
                className="w-14 h-14 rounded-full bg-neutral-100 text-neutral-950 flex items-center justify-center shadow-xl"
              >
                <span className="flex items-center justify-center w-6 h-6">
                  {isCurrentPlaying ? (
                    <Pause className="w-6 h-6 fill-current" />
                  ) : (
                    <Play className="w-6 h-6 fill-current translate-x-px" />
                  )}
                </span>
              </motion.button>
            )}
          </div>
        </div>

        {(track.status === 'verified' || track.status === 'approved' || track.status === 'suspended') && (
          <div className="absolute bottom-2 right-2 h-5 w-5 rounded-full bg-black/50 flex items-center justify-center">
            <TrackMark status={track.status} />
          </div>
        )}

        {isCurrent && (
          <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-full bg-black/70 px-2.5 py-1">
            <div className="relative w-6 h-3">
              <LiveBars trackId={track.id} barCount={7} />
            </div>
            <span className="text-[10px] font-medium text-neutral-200 tabular-nums">{formatTime(track.duration)}</span>
          </div>
        )}
      </Link>

      <div className="flex flex-col gap-1 px-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link to={`/track/${track.id}`} className="block">
              <h3 className="text-sm font-medium text-neutral-100 truncate hover:underline">{track.title}</h3>
            </Link>
            {track.uploader?.id ? (
              <Link
                to={`/user/${track.uploader.id}`}
                className="text-xs text-neutral-500 truncate block hover:underline hover:text-neutral-300"
              >
                {track.artist}
              </Link>
            ) : (
              <span className="text-xs text-neutral-500 truncate block">{track.artist}</span>
            )}
            {track.source === 'soundcloud' && (
              <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-neutral-400">
                <CloudDownload className="w-3 h-3" /> Imported from SoundCloud
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1 text-[11px] text-neutral-500 tabular-nums">
              <Heart className="w-3 h-3" />
              {formatCount(track.likes)}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-neutral-600 tabular-nums">
              <Play className="w-3 h-3" />
              {formatCount(track.plays)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
