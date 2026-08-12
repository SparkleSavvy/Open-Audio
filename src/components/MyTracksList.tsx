import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { Upload, RotateCcw, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { api } from '../lib/api';
import type { Track } from '../types';
import TrackListRow from './TrackListRow';

interface MyTracksListProps {
  onNewTrack?: () => void;
}

export default function MyTracksList({ onNewTrack }: MyTracksListProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getMyTracks()
      .then(({ tracks }) => setTracks(tracks))
      .catch(() => setTracks([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const remove = async (track: Track) => {
    if (!window.confirm(`Delete "${track.title}" permanently?`)) return;
    setBusyId(track.id);
    setError(null);
    try {
      await api.deleteTrack(track.id);
      load();
    } catch {
      setError('Could not delete the track — try again');
    } finally {
      setBusyId(null);
    }
  };

  const resubmit = async (track: Track) => {
    setBusyId(track.id);
    setError(null);
    try {
      await api.resubmit(track.id);
      load();
    } catch {
      setError('Could not resubmit the track — try again');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-neutral-900 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p className="mb-4 text-sm text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-2.5">{error}</p>
      )}

      {tracks.length === 0 ? (
        <div className="py-24 text-center">
          <Upload className="w-10 h-10 text-neutral-700 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">You haven't uploaded anything yet.</p>
          {onNewTrack ? (
            <button
              onClick={onNewTrack}
              className="inline-block mt-4 text-sm font-medium text-neutral-100 hover:underline"
            >
              Upload your first track
            </button>
          ) : (
            <Link to="/upload" className="inline-block mt-4 text-sm font-medium text-neutral-100 hover:underline">
              Upload your first track
            </Link>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {tracks.map((track) => (
            <motion.div key={track.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <TrackListRow
                track={track}
                showStatus
                onDelete={remove}
                extra={
                  track.status === 'rejected' ? (
                    <button
                      onClick={() => resubmit(track)}
                      disabled={busyId === track.id}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-300 hover:text-neutral-100 border border-neutral-800 hover:border-neutral-600 rounded-full px-3 py-1 transition-colors shrink-0 disabled:opacity-40"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Resubmit
                    </button>
                  ) : track.status === 'suspended' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-400/90 shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5" /> Playback disabled
                    </span>
                  ) : undefined
                }
              />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
