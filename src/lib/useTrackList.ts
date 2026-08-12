import { useEffect, useState } from 'react';
import type { Track } from '../types';

// Shared fetch lifecycle for track lists: cancels in-flight requests on
// re-run/unmount, clears on error and when `enabled` flips to false.
// `load` must be memoized with useCallback by the caller.
export function useTrackList(load: () => Promise<{ tracks: Track[] }>, enabled = true) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setTracks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    load()
      .then(({ tracks }) => {
        if (!cancelled) setTracks(tracks);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, enabled]);

  return { tracks, setTracks, loading, setLoading };
}
