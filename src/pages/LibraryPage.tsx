import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import {
  Heart,
  LogIn,
  LayoutGrid,
  List,
  Search,
  ListMusic,
  Disc3,
  Radio,
  History,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { usePlayer } from '../lib/PlayerContext';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import LibraryCard from '../components/LibraryCard';
import LibraryRow from '../components/LibraryRow';
import StaggerGrid, { staggerItem } from '../components/StaggerGrid';
import Skeleton from '../components/Skeleton';
import { useTrackList } from '../lib/useTrackList';
import { formatCount } from '../lib/format';
import type { FollowedUser, Track } from '../types';

type Tab = 'overview' | 'likes' | 'playlists' | 'albums' | 'stations' | 'following' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'likes', label: 'Likes' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'stations', label: 'Stations' },
  { id: 'following', label: 'Following' },
  { id: 'history', label: 'History' },
];

const HEADLINES: Record<Tab, string> = {
  overview: "Hear the tracks you've liked:",
  likes: "Tracks you've liked:",
  playlists: 'Your playlists:',
  albums: 'Your albums:',
  stations: 'Your stations:',
  following: 'People you follow:',
  history: 'Your listening history:',
};

const PLACEHOLDERS: Partial<Record<Tab, { icon: LucideIcon; title: string; text: string }>> = {
  playlists: { icon: ListMusic, title: 'No playlists yet', text: 'Playlists arrive in the next update.' },
  albums: { icon: Disc3, title: 'No albums yet', text: 'Albums arrive in the next update.' },
  stations: { icon: Radio, title: 'No stations yet', text: 'Stations arrive in the next update.' },
  history: { icon: History, title: 'No listening history yet', text: 'Tracks you play will show up here.' },
};

function EmptyState({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="py-24 flex flex-col items-center gap-3 text-center">
      <Icon className="w-10 h-10 text-neutral-700" />
      <p className="text-sm font-medium text-neutral-300">{title}</p>
      <p className="text-sm text-neutral-500 max-w-sm">{text}</p>
    </div>
  );
}

function FollowingAvatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    return <img src={url} alt={name} loading="lazy" className="w-full h-full object-cover" />;
  }
  return (
    <span className="flex items-center justify-center w-full h-full text-xl font-semibold text-neutral-400 uppercase">
      {name.slice(0, 2)}
    </span>
  );
}

export default function LibraryPage() {
  const { user, loading: authLoading } = useAuth();
  const player = usePlayer();
  const reduced = usePrefersReducedMotion();

  const [tab, setTab] = useState<Tab>('overview');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');

  const [following, setFollowing] = useState<FollowedUser[]>([]);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [followBusyIds, setFollowBusyIds] = useState<Set<number>>(new Set());

  const loadLikes = useCallback(() => api.getTracks({ liked: true }), []);
  const { tracks, setTracks, loading } = useTrackList(loadLikes, Boolean(user));

  useEffect(() => {
    if (!user) {
      setFollowing([]);
      setFollowingLoading(false);
      return;
    }
    let cancelled = false;
    setFollowingLoading(true);
    api
      .getUserFollowing(user.id)
      .then(({ users }) => {
        if (!cancelled) setFollowing(users);
      })
      .catch(() => {
        if (!cancelled) setFollowing([]);
      })
      .finally(() => {
        if (!cancelled) setFollowingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (authLoading) {
    return <div className="h-40" />;
  }

  if (!user) {
    return (
      <div className="py-24 flex flex-col items-center gap-4 text-center">
        <Heart className="w-10 h-10 text-neutral-700" />
        <h1 className="text-lg font-semibold text-neutral-100">Your library</h1>
        <p className="text-sm text-neutral-400 max-w-sm">
          Log in to like tracks and keep them here for quick access.
        </p>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 px-5 py-2 rounded-full transition-colors mt-2"
        >
          <LogIn className="w-4 h-4" /> Log in
        </Link>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = tracks.filter(
    (t) => !q || t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
  );
  const filteredFollowing = following.filter((f) => !q || f.user.username.toLowerCase().includes(q));

  const showTracks = tab === 'overview' || tab === 'likes';
  const isDataTab = showTracks || tab === 'following';
  const placeholder = PLACEHOLDERS[tab];

  const playList = (track: Track, list: Track[]) => player.playTrack(track, list);

  const toggleLike = async (track: Track) => {
    if (!user) return;
    try {
      const res = await api.toggleLike(track.id);
      setTracks((prev) =>
        prev
          .map((t) => (t.id === track.id ? { ...t, liked: res.liked, likes: res.likes } : t))
          .filter((t) => !(t.id === track.id && !res.liked)),
      );
    } catch {
      /* ignore */
    }
  };

  const toggleFollowUser = async (f: FollowedUser) => {
    if (!user || followBusyIds.has(f.user.id)) return;
    setFollowBusyIds((prev) => new Set(prev).add(f.user.id));
    try {
      const res = await api.toggleFollow(f.user.id);
      setFollowing((prev) =>
        prev.map((x) =>
          x.user.id === f.user.id ? { ...x, isFollowing: res.following, followers: res.followers } : x,
        ),
      );
    } catch {
      /* ignore */
    } finally {
      setFollowBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(f.user.id);
        return next;
      });
    }
  };

  const followButton = (f: FollowedUser) =>
    user && f.user.id !== user.id ? (
      <button
        onClick={() => toggleFollowUser(f)}
        disabled={followBusyIds.has(f.user.id)}
        className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors disabled:opacity-40 ${
          f.isFollowing
            ? 'border border-neutral-800 text-neutral-400 hover:text-neutral-100'
            : 'bg-neutral-100 text-neutral-950 hover:bg-neutral-300'
        }`}
      >
        {f.isFollowing ? 'Following' : 'Follow'}
      </button>
    ) : null;

  const trackIsPlaying = (t: Track) => player.current?.id === t.id && player.isPlaying;

  const renderSkeleton = () => (
    <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-10">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-md" />
      ))}
    </div>
  );

  const renderTrackContent = () => {
    if (loading) return renderSkeleton();

    if (filtered.length === 0) {
      return tracks.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No liked tracks yet"
          text="Tap the heart on any track to keep it here for quick access."
        />
      ) : (
        <EmptyState icon={Search} title={`No results for "${query.trim()}"`} text="Try a different search." />
      );
    }

    if (view === 'list') {
      return (
        <div className="mt-8 flex flex-col rounded-lg border border-neutral-900 divide-y divide-neutral-900">
          {filtered.map((track) => (
            <LibraryRow
              key={track.id}
              trackId={track.id}
              cover={track.coverUrl}
              title={track.title}
              artist={track.artist}
              duration={track.duration}
              isLiked={track.liked}
              isPlaying={trackIsPlaying(track)}
              href={`/track/${track.id}`}
              onPlay={() => playList(track, filtered)}
              onLike={() => toggleLike(track)}
            />
          ))}
        </div>
      );
    }

    return (
      <StaggerGrid className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-10">
        {filtered.map((track) => (
          <motion.div key={track.id} variants={staggerItem}>
            <LibraryCard
              trackId={track.id}
              cover={track.coverUrl}
              title={track.title}
              artist={track.artist}
              duration={track.duration}
              isLiked={track.liked}
              isPlaying={trackIsPlaying(track)}
              href={`/track/${track.id}`}
              onPlay={() => playList(track, filtered)}
              onLike={() => toggleLike(track)}
            />
          </motion.div>
        ))}
      </StaggerGrid>
    );
  };

  const renderFollowingContent = () => {
    if (followingLoading) return renderSkeleton();

    if (filteredFollowing.length === 0) {
      return following.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Not following anyone yet"
          text="People you follow will show up here."
        />
      ) : (
        <EmptyState icon={Search} title={`No results for "${query.trim()}"`} text="Try a different search." />
      );
    }

    if (view === 'list') {
      return (
        <div className="mt-8 flex flex-col rounded-lg border border-neutral-900 divide-y divide-neutral-900">
          {filteredFollowing.map((f) => (
            <div key={f.user.id} className="group flex items-center gap-4 px-3 py-2.5 rounded-lg transition-colors hover:bg-neutral-900">
              <Link
                to={`/user/${f.user.id}`}
                className="relative block w-12 h-12 shrink-0 overflow-hidden rounded-md bg-neutral-900"
              >
                <FollowingAvatar url={f.user.avatarUrl} name={f.user.username} />
              </Link>
              <Link to={`/user/${f.user.id}`} className="flex-1 min-w-0">
                <p className="text-sm text-neutral-200 truncate hover:underline">{f.user.username}</p>
                <p className="text-xs text-neutral-500 tabular-nums">{formatCount(f.followers)} followers</p>
              </Link>
              {followButton(f)}
            </div>
          ))}
        </div>
      );
    }

    return (
      <StaggerGrid className="mt-8 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-10">
        {filteredFollowing.map((f) => (
          <motion.div key={f.user.id} variants={staggerItem} className="flex flex-col gap-2.5">
            <Link
              to={`/user/${f.user.id}`}
              className="relative block aspect-square overflow-hidden rounded-md bg-neutral-900"
            >
              <FollowingAvatar url={f.user.avatarUrl} name={f.user.username} />
            </Link>
            <div className="min-w-0 px-0.5">
              <Link to={`/user/${f.user.id}`} className="block">
                <h3 className="text-sm font-semibold text-neutral-100 truncate hover:underline">{f.user.username}</h3>
              </Link>
              <p className="text-xs text-neutral-500 tabular-nums">{formatCount(f.followers)} followers</p>
            </div>
            {followButton(f)}
          </motion.div>
        ))}
      </StaggerGrid>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {/* TABS */}
      <div className="border-b border-neutral-900">
        <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Library sections">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative shrink-0 pb-3 pt-1 text-sm whitespace-nowrap transition-colors press ${
                  active ? 'text-neutral-100 font-semibold' : 'text-neutral-500 hover:text-neutral-200'
                }`}
              >
                {t.label}
                {active && (
                  <motion.span
                    layoutId={reduced ? undefined : 'library-tab'}
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-neutral-100"
                    transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* CONTROL PANEL */}
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">{HEADLINES[tab]}</h1>

        {isDataTab && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">View</span>
              <div className="flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-900 p-0.5">
                <button
                  onClick={() => setView('grid')}
                  className={`w-8 h-8 flex items-center justify-center rounded transition-colors press ${
                    view === 'grid' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-400 hover:text-neutral-100'
                  }`}
                  title="Grid view"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setView('list')}
                  className={`w-8 h-8 flex items-center justify-center rounded transition-colors press ${
                    view === 'list' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-400 hover:text-neutral-100'
                  }`}
                  title="List view"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter"
                className="w-44 sm:w-56 pl-9 pr-3 py-2 text-sm bg-neutral-900 border border-neutral-800 rounded-full text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-600 transition-colors"
              />
            </div>
          </div>
        )}
      </div>

      {/* CONTENT */}
      {placeholder ? (
        <EmptyState icon={placeholder.icon} title={placeholder.title} text={placeholder.text} />
      ) : showTracks ? (
        renderTrackContent()
      ) : (
        renderFollowingContent()
      )}
    </motion.div>
  );
}
