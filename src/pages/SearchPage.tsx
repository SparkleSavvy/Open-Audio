import { useCallback, useEffect, useState, FormEvent } from 'react';
import { useSearchParams, Link } from 'react-router';
import { motion } from 'motion/react';
import { Search, SearchX } from 'lucide-react';
import { api } from '../lib/api';
import TrackCard from '../components/TrackCard';
import StaggerGrid, { staggerItem } from '../components/StaggerGrid';
import { useTrackList } from '../lib/useTrackList';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const loadTracks = useCallback(() => api.getTracks({ q: q.trim() }), [q]);
  const { tracks, loading } = useTrackList(loadTracks, Boolean(q.trim()));

  useEffect(() => {
    setInput(q);
  }, [q]);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === q) return;
    const t = setTimeout(() => setParams(trimmed ? { q: trimmed } : {}), 300);
    return () => clearTimeout(t);
  }, [input, q, setParams]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setParams(input.trim() ? { q: input.trim() } : {});
  };

  return (
    <div>
      <form onSubmit={submit} className="mb-8">
        <div className="relative max-w-2xl">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-neutral-500" />
          </div>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search tracks, artists…"
            className="block w-full pl-11 pr-4 py-3 border border-neutral-800 rounded-lg leading-6 bg-neutral-900 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:bg-neutral-800 focus:border-neutral-600 transition-colors text-base"
          />
        </div>
      </form>

      <div className="mb-6">
        {q.trim() ? (
          <p className="text-sm text-neutral-400">
            {loading ? (
              'Searching…'
            ) : (
              <>
                {tracks.length} result{tracks.length === 1 ? '' : 's'} for <span className="text-neutral-200">“{q}”</span>
              </>
            )}
          </p>
        ) : (
          <p className="text-sm text-neutral-500">Type something to search approved tracks.</p>
        )}
      </div>

      {!loading && q.trim() && tracks.length === 0 && (
        <div className="py-20 flex flex-col items-center gap-3 text-center">
          <SearchX className="w-10 h-10 text-neutral-700" />
          <p className="text-sm text-neutral-400">No tracks match your search.</p>
          <Link to="/upload" className="text-sm font-medium text-neutral-100 hover:underline">
            Upload a track instead
          </Link>
        </div>
      )}

      <StaggerGrid className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-10">
        {tracks.map((track, i) => (
          <motion.div key={track.id} variants={staggerItem}>
            <TrackCard track={track} index={i} />
          </motion.div>
        ))}
      </StaggerGrid>
    </div>
  );
}
