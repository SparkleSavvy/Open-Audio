import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Heart,
  MapPin,
  MessageCircle,
  Music2,
  Pencil,
  Share2,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { usePlayer } from '../lib/PlayerContext';
import { formatCount, formatDate } from '../lib/format';
import type { FollowedUser, Track, UserProfile } from '../types';
import TrackListRow from '../components/TrackListRow';
import SupporterBadge from '../components/SupporterBadge';
import Skeleton from '../components/Skeleton';

function Avatar({ url, name, size = 'md' }: { url: string | null; name: string; size?: 'md' | 'sm' | 'lg' }) {
  const cls =
    size === 'lg' ? 'w-24 h-24 text-2xl' : size === 'md' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-[10px]';
  return (
    <div className={`${cls} rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 shrink-0`}>
      {url ? (
        <img src={url} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="flex items-center justify-center w-full h-full font-semibold text-neutral-300 uppercase">
          {name.slice(0, 2)}
        </span>
      )}
    </div>
  );
}

type Tab = 'tracks' | 'popular' | 'reposts';

const TABS: { key: Tab; label: string }[] = [
  { key: 'tracks', label: 'Tracks' },
  { key: 'popular', label: 'Popular tracks' },
  { key: 'reposts', label: 'Reposts' },
];

async function fetchProfileBundle(profileId: number): Promise<{
  profile: UserProfile | null;
  tracks: Track[];
  likes: Track[];
  following: FollowedUser[];
  notFound: boolean;
  error: string | null;
}> {
  if (!Number.isFinite(profileId) || profileId <= 0) {
    return { profile: null, tracks: [], likes: [], following: [], notFound: true, error: null };
  }
  const p = api.getUserProfile(profileId);
  const t = api.getUserTracks(profileId, 'latest');
  const l = api.getUserLikes(profileId);
  const f = api.getUserFollowing(profileId);

  let profile: UserProfile | null = null;
  let notFound = false;
  let error: string | null = null;
  await p
    .then(({ profile: pr }) => {
      profile = pr;
    })
    .catch((e) => {
      if (e.status === 404) notFound = true;
      else error = e.message ?? 'Could not load the profile';
    });

  const [tracks, likes, following] = await Promise.all([
    t.then(({ tracks: list }) => list).catch(() => [] as Track[]),
    l.then(({ tracks: list }) => list).catch(() => [] as Track[]),
    f.then(({ users }) => users).catch(() => [] as FollowedUser[]),
  ]);
  return { profile, tracks, likes, following, notFound, error };
}

export default function UserProfilePage() {
  const { id } = useParams();
  const profileId = Number(id);
  const { user } = useAuth();
  const { showNotice } = usePlayer();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [likes, setLikes] = useState<Track[]>([]);
  const [following, setFollowing] = useState<FollowedUser[]>([]);
  const [tab, setTab] = useState<Tab>('tracks');
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [followBusyIds, setFollowBusyIds] = useState<Set<number>>(new Set());
  const [showAllFollowing, setShowAllFollowing] = useState(false);

  const loadProfile = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);
    setProfile(null);
    setTracks([]);
    setLikes([]);
    setFollowing([]);
    setShowAllFollowing(false);
    setTab('tracks');

    fetchProfileBundle(profileId).then((result) => {
      if (cancelled) return;
      setProfile(result.profile);
      setTracks(result.tracks);
      setLikes(result.likes);
      setFollowing(result.following);
      setNotFound(result.notFound);
      setError(result.error);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [profileId]);

  useEffect(() => loadProfile(), [loadProfile, retryKey]);

  useEffect(() => {
    if (loading || !Number.isFinite(profileId) || profileId <= 0) return;
    let cancelled = false;
    setTabLoading(true);
    const load =
      tab === 'tracks'
        ? api.getUserTracks(profileId, 'latest')
        : tab === 'popular'
          ? api.getUserTracks(profileId, 'popular')
          : api.getUserReposts(profileId);
    load
      .then(({ tracks }) => {
        if (!cancelled) setTracks(tracks);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      })
      .finally(() => {
        if (!cancelled) setTabLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, profileId, loading]);

  const isOwner = !!user && profile?.id === user.id;

  const toggleFollow = async () => {
    if (!user) {
      showNotice('Log in to follow artists');
      return;
    }
    if (followBusy || !profile) return;
    setFollowBusy(true);
    try {
      const res = await api.toggleFollow(profile.id);
      setProfile((p) => (p ? { ...p, isFollowing: res.following, followers: res.followers } : p));
    } catch {
      showNotice('Something went wrong, try again');
    } finally {
      setFollowBusy(false);
    }
  };

  const toggleFollowUser = async (f: FollowedUser) => {
    if (!user) {
      showNotice('Log in to follow artists');
      return;
    }
    if (followBusyIds.has(f.user.id)) return;
    setFollowBusyIds((s) => new Set(s).add(f.user.id));
    try {
      const res = await api.toggleFollow(f.user.id);
      setFollowing((list) =>
        list.map((x) =>
          x.user.id === f.user.id ? { ...x, isFollowing: res.following, followers: res.followers } : x,
        ),
      );
    } catch {
      showNotice('Something went wrong, try again');
    } finally {
      setFollowBusyIds((s) => {
        const next = new Set(s);
        next.delete(f.user.id);
        return next;
      });
    }
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showNotice('Link copied to clipboard', 'success');
    } catch {
      showNotice('Could not copy the link');
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton className="h-48 sm:h-56 rounded-xl" />
        <div className="flex items-center gap-4 mt-5">
          <Skeleton className="w-24 h-24 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48 rounded" />
            <Skeleton className="h-3 w-32 rounded" />
          </div>
        </div>
        <div className="mt-8 grid lg:grid-cols-[minmax(0,1fr)_340px] gap-8">
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-52 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="py-24 flex flex-col items-center gap-3 text-center">
        <Users className="w-10 h-10 text-neutral-700" />
        <h1 className="text-xl font-bold text-neutral-100">Profile not found</h1>
        <p className="text-sm text-neutral-500">This user does not exist or was removed.</p>
        <Link to="/" className="mt-2 text-sm font-medium text-neutral-100 hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-24 flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="w-10 h-10 text-amber-400" />
        <h1 className="text-xl font-bold text-neutral-100">Something went wrong</h1>
        <p className="text-sm text-neutral-500">{error}</p>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          className="mt-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 px-5 py-2 rounded-full transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!profile) return null;

  const lastCover =
    tracks.find((t) => t.coverUrl)?.coverUrl ?? likes.find((t) => t.coverUrl)?.coverUrl ?? null;
  const topLikes = [...likes].sort((a, b) => b.likes - a.likes).slice(0, 5);
  const shownFollowing = showAllFollowing ? following : following.slice(0, 5);

  return (
    <div>
      {/* BANNER */}
      <div className="relative h-48 sm:h-56 rounded-xl overflow-hidden border border-neutral-900">
        {lastCover ? (
          <img src={lastCover} alt="" className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-60" />
        ) : (
          <div className="absolute inset-0 bg-neutral-900" />
        )}
        <div className="absolute inset-0 bg-neutral-950/60" />
        <div className="absolute bottom-4 left-5 right-5 flex items-end gap-4">
          <div className="rounded-full ring-4 ring-neutral-950">
            <Avatar url={profile.avatar_url} name={profile.username} size="lg" />
          </div>
          <div className="min-w-0 pb-0.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-100 truncate flex items-center gap-2">
              {profile.username}
              {profile.supporter && <SupporterBadge />}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-neutral-300">
              {profile.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> {profile.location}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> Joined {formatDate(profile.created_at)}
              </span>
            </div>
            {profile.bio && <p className="text-sm text-neutral-300 mt-1.5 line-clamp-2">{profile.bio}</p>}
          </div>
        </div>
      </div>

      {/* ACTIONS */}
      <div className="flex flex-wrap items-center gap-2.5 mt-4">
        {isOwner ? (
          <button
            onClick={() => showNotice('Profile editing arrives in the next update')}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border border-neutral-800 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 press"
          >
            <Pencil className="w-4 h-4" /> Edit profile
          </button>
        ) : (
          <button
            onClick={toggleFollow}
            disabled={followBusy}
            className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full press disabled:opacity-40 ${
              profile.isFollowing
                ? 'border border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-100'
                : 'bg-neutral-100 text-neutral-950 hover:bg-neutral-300'
            }`}
          >
            {profile.isFollowing ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {profile.isFollowing ? 'Following' : 'Follow'}
          </button>
        )}
        <button
          onClick={() => showNotice('Messaging arrives in the next update')}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border border-neutral-800 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 press"
        >
          <MessageCircle className="w-4 h-4" /> Message
        </button>
        <button
          onClick={share}
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border border-neutral-800 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 press"
        >
          <Share2 className="w-4 h-4" /> Share
        </button>
      </div>

      {/* BODY */}
      <div className="mt-8 grid lg:grid-cols-[minmax(0,1fr)_340px] gap-8 items-start">
        {/* LEFT */}
        <div className="min-w-0">
          <div className="relative flex items-center gap-1 border-b border-neutral-900 mb-4">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative px-4 py-2.5 text-sm font-medium press ${
                  tab === t.key ? 'text-neutral-100' : 'text-neutral-500 hover:text-neutral-200'
                }`}
              >
                {tab === t.key && (
                  <motion.span
                    layoutId="profile-tab"
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-neutral-100"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                )}
                <span className="relative">{t.label}</span>
              </button>
            ))}
          </div>

          {tabLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 rounded-lg bg-neutral-900 animate-pulse" />
              ))}
            </div>
          ) : tracks.length === 0 ? (
            <div className="py-20 flex flex-col items-center gap-3 text-center">
              <Music2 className="w-10 h-10 text-neutral-700" />
              <p className="text-sm text-neutral-500">
                {tab === 'reposts' ? 'No reposts yet.' : 'No tracks yet.'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {tracks.map((track) => (
                <TrackListRow key={track.id} track={track} showStatus={isOwner} />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR */}
        <aside className="space-y-6 min-w-0">
          {/* STATS */}
          <div className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
            <h2 className="text-xs font-semibold text-neutral-400 mb-4">Stats</h2>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Followers</span>
                <span className="text-sm font-semibold text-neutral-100 tabular-nums">
                  {formatCount(profile.followers)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Following</span>
                <span className="text-sm font-semibold text-neutral-100 tabular-nums">
                  {formatCount(profile.following)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Tracks</span>
                <span className="text-sm font-semibold text-neutral-100 tabular-nums">
                  {formatCount(profile.trackCount)}
                </span>
              </div>
            </div>
          </div>

          {/* LIKES */}
          <div className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
            <h2 className="text-xs font-semibold text-neutral-400 mb-4 flex items-center justify-between">
              <span>Likes</span>
              <span className="text-neutral-600 tabular-nums">{likes.length}</span>
            </h2>
            {topLikes.length === 0 ? (
              <p className="text-xs text-neutral-600">No liked tracks yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {topLikes.map((t) => (
                  <Link key={t.id} to={`/track/${t.id}`} className="group flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 shrink-0 overflow-hidden rounded-sm bg-neutral-800">
                      {t.coverUrl ? (
                        <img src={t.coverUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-neutral-800" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-neutral-200 truncate group-hover:underline">{t.title}</p>
                      <p className="text-xs text-neutral-600">{t.artist}</p>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-neutral-500 tabular-nums shrink-0">
                      <Heart className="w-3 h-3" /> {formatCount(t.likes)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* FOLLOWING */}
          <div className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
            <h2 className="text-xs font-semibold text-neutral-400 mb-4 flex items-center justify-between">
              <span>Following</span>
              <span className="text-neutral-600 tabular-nums">{following.length}</span>
            </h2>
            {shownFollowing.length === 0 ? (
              <p className="text-xs text-neutral-600">Not following anyone yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {shownFollowing.map((f) => (
                  <div key={f.user.id} className="flex items-center gap-3 min-w-0">
                    <Link to={`/user/${f.user.id}`} className="flex items-center gap-3 min-w-0 flex-1">
                      <Avatar url={f.user.avatarUrl} name={f.user.username} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm text-neutral-200 truncate hover:underline">{f.user.username}</p>
                        <p className="text-xs text-neutral-600 tabular-nums">{formatCount(f.followers)} followers</p>
                      </div>
                    </Link>
                    {user && f.user.id !== user.id && (
                      <button
                        onClick={() => toggleFollowUser(f)}
                        disabled={followBusyIds.has(f.user.id)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors disabled:opacity-40 shrink-0 ${
                          f.isFollowing
                            ? 'border border-neutral-800 text-neutral-400 hover:text-neutral-100'
                            : 'bg-neutral-100 text-neutral-950 hover:bg-neutral-300'
                        }`}
                      >
                        {f.isFollowing ? 'Following' : 'Follow'}
                      </button>
                    )}
                  </div>
                ))}
                {following.length > 5 && (
                  <button
                    onClick={() => setShowAllFollowing((v) => !v)}
                    className="flex items-center justify-center gap-1 mt-1 text-xs font-medium text-neutral-400 hover:text-neutral-100 transition-colors"
                  >
                    {showAllFollowing ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5" /> Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" /> View all ({following.length})
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
