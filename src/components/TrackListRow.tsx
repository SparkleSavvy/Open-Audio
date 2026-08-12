import { Link } from 'react-router';
import { Play, Pause, Download, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Track } from '../types';
import { usePlayer } from '../lib/PlayerContext';
import { downloadTrack } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { downloadGateReason } from '../lib/download';
import { formatTime } from '../lib/format';
import StatusBadge from './StatusBadge';

interface TrackListRowProps {
  key?: string | number;
  track: Track;
  showStatus?: boolean;
  extra?: ReactNode;
  onDelete?: (track: Track) => void;
}

export default function TrackListRow({ track, showStatus = false, extra, onDelete }: TrackListRowProps) {
  const { user } = useAuth();
  const { current, isPlaying, playTrack, showNotice } = usePlayer();
  const isCurrent = current?.id === track.id;
  const isCurrentPlaying = isCurrent && isPlaying;
  const suspended = track.status === 'suspended';
  const downloadReason = downloadGateReason(track, user);

  const handleDownload = () => {
    if (downloadReason) return showNotice(downloadReason);
    downloadTrack(track);
  };

  return (
    <div
      className={`group flex items-center gap-4 rounded-lg px-3 py-2.5 transition-colors ${
        isCurrent ? 'bg-neutral-900' : 'hover:bg-neutral-900/60'
      }`}
    >
      <button
        onClick={() => playTrack(track)}
        disabled={suspended}
        className="press w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-neutral-300 hover:text-neutral-100 disabled:cursor-not-allowed disabled:text-neutral-600"
        title={suspended ? 'Playback suspended' : isCurrentPlaying ? 'Pause' : 'Play'}
      >
        {isCurrentPlaying && !suspended ? (
          <Pause className="w-4 h-4 fill-current" />
        ) : (
          <Play className="w-4 h-4 fill-current" />
        )}
      </button>

      <Link to={`/track/${track.id}`} className="w-11 h-11 shrink-0 overflow-hidden rounded-sm bg-neutral-800">
        {track.coverUrl ? (
          <img src={track.coverUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-neutral-800" />
        )}
      </Link>

      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/track/${track.id}`}
            className="text-sm font-medium text-neutral-100 truncate hover:underline"
          >
            {track.title}
          </Link>
          {showStatus && <StatusBadge status={track.status} />}
        </div>
        <span className="text-xs text-neutral-500 truncate">{track.artist}</span>
      </div>

      <span className="text-xs text-neutral-600 tabular-nums shrink-0 hidden sm:block">
        {formatTime(track.duration)}
      </span>

      {track.status === 'rejected' && track.rejectionReason && (
        <span
          className="hidden lg:block max-w-[220px] text-xs text-red-400/80 truncate shrink-0"
          title={track.rejectionReason}
        >
          {track.rejectionReason}
        </span>
      )}

      {extra}

      <button
        onClick={handleDownload}
        disabled={suspended}
        className="press text-neutral-500 hover:text-neutral-100 shrink-0 disabled:text-neutral-700 disabled:cursor-not-allowed"
        title={suspended ? 'Playback suspended' : downloadReason ?? 'Download'}
      >
        <Download className="w-4 h-4" />
      </button>

      {onDelete && (
        <button
          onClick={() => onDelete(track)}
          className="press text-neutral-600 hover:text-red-400 shrink-0"
          title="Delete track"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
