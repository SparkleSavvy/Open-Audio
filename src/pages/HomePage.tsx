import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { Music2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import TrackCard from '../components/TrackCard';
import StaggerGrid, { staggerItem } from '../components/StaggerGrid';
import Skeleton from '../components/Skeleton';
import { useTrackList } from '../lib/useTrackList';

// Session-scoped flag: the entrance animation plays once, on the first visit
// to Home. Mutating it inside a useState initializer is unsafe under React
// StrictMode (the initializer runs twice), so it is set in an effect instead.
let entrancePlayed = false;

export default function HomePage() {
  const [sort, setSort] = useState<'latest' | 'popular'>('latest');
  const entranceRef = useRef<boolean | null>(null);
  if (entranceRef.current === null) {
    entranceRef.current = !entrancePlayed;
  }
  useEffect(() => {
    entrancePlayed = true;
  }, []);
  const animateIn = entranceRef.current ?? false;
  const loadTracks = useCallback(() => api.getTracks({ sort }), [sort]);
  const { tracks, loading } = useTrackList(loadTracks);

  return (
    <div>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Latest drops</h1>
          <p className="text-sm text-neutral-400 mt-1">Fresh music from the community — download anything, free</p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900 p-1">
          {(['latest', 'popular'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
                sort === s ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-400 hover:text-neutral-100'
              }`}
            >
              {s === 'latest' ? 'Latest' : 'Popular'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-10">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="aspect-square rounded-sm" />
              <Skeleton className="h-3 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ) : tracks.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-3 text-center">
          <Music2 className="w-10 h-10 text-neutral-700" />
          <p className="text-sm text-neutral-500">Nothing here yet. Be the first to upload.</p>
          <Link
            to="/upload"
            className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 px-5 py-2 rounded-full transition-colors"
          >
            <Upload className="w-4 h-4" /> Upload a track
          </Link>
        </div>
      ) : (
        <StaggerGrid
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-10"
          animateIn={animateIn}
        >
          {tracks.map((track) => (
            <motion.div key={track.id} variants={staggerItem}>
              <TrackCard track={track} />
            </motion.div>
          ))}
        </StaggerGrid>
      )}
    </div>
  );
}
