import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  Play,
  Pause,
  Download,
  Heart,
  Lock,
  ArrowLeft,
  AlertTriangle,
  Repeat,
  Share2,
  ListPlus,
  Send,
  X,
  MapPin,
  MessageCircle,
  Users,
  Music2,
  CloudDownload,
  ExternalLink,
} from 'lucide-react';
import { motion } from 'motion/react';
import { api, ApiError, downloadTrack } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { usePlayer } from '../lib/PlayerContext';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';
import { downloadGateReason } from '../lib/download';
import { formatCount, formatQuality, formatTime, qualityTier, QUALITY_TIER_LABEL, timeAgo } from '../lib/format';
import type { Comment, Fan, Track, UserProfile } from '../types';
import TrackMark from '../components/TrackMark';
import Waveform from '../components/Waveform';
import Skeleton from '../components/Skeleton';

function Avatar({ url, name, size = 'md' }: { url: string | null; name: string; size?: 'md' | 'sm' }) {
  const cls =
    size === 'md'
      ? 'w-16 h-16 text-lg'
      : 'w-8 h-8 text-[10px]';
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

async function loadTrackDetails(id: number): Promise<{ track: Track; profile: UserProfile | null; fans: Fan[] }> {
  const { track } = await api.getTrack(id);
  const [profile, fans] = await Promise.all([
    track.uploader
      ? api.getUserProfile(track.uploader.id).then(({ profile: p }) => p).catch(() => null)
      : Promise.resolve(null),
    api.getTrackFans(id).then(({ fans: f }) => f).catch(() => [] as Fan[]),
  ]);
  return { track, profile, fans };
}

export default function TrackDetailPage() {
  const { id } = useParams();
  const trackId = Number(id);
  const { user } = useAuth();
  const player = usePlayer();
  const { showNotice } = player;
  const reduced = usePrefersReducedMotion();

  const [track, setTrack] = useState<Track | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);

  const [reposted, setReposted] = useState(false);
  const [reposts, setReposts] = useState(0);
  const [repostBusy, setRepostBusy] = useState(false);

  const [comments, setComments] = useState<Comment[]>([]);
  const [commentFilter, setCommentFilter] = useState<'newest' | 'oldest'>('newest');
  const [commentBody, setCommentBody] = useState('');
  const [commentTs, setCommentTs] = useState(0);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const commentInputRef = useRef<HTMLInputElement>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [fans, setFans] = useState<Fan[]>([]);

  const loadComments = (filter: 'newest' | 'oldest') => {
    let cancelled = false;
    api
      .getTrackComments(trackId, filter)
      .then(({ comments: list }) => {
        if (!cancelled) setComments(list);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  };

  const loadTrack = useCallback((id: number) => {
    let cancelled = false;
    setLoading(true);
    setBlocked(false);
    setNotFound(false);
    loadTrackDetails(id)
      .then(({ track: t, profile: p, fans: f }) => {
        if (cancelled) return;
        setTrack(t);
        setLiked(t.liked);
        setLikes(t.likes);
        setReposted(t.reposted);
        setReposts(t.reposts);
        setProfile(p);
        setFans(f);
        setCommentTs(0);
        setReplyTo(null);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403) setBlocked(true);
        else setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadTrack(trackId), [trackId, loadTrack]);

  useEffect(() => {
    if (Number.isFinite(trackId) && trackId > 0) return loadComments(commentFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, commentFilter]);

  const toggleLike = async () => {
    if (!user || likeBusy) return;
    setLikeBusy(true);
    try {
      const res = await api.toggleLike(trackId);
      setLiked(res.liked);
      setLikes(res.likes);
    } catch {
      /* ignore */
    } finally {
      setLikeBusy(false);
    }
  };

  const toggleRepost = async () => {
    if (!user || repostBusy) {
      if (!user) showNotice('Log in to repost');
      return;
    }
    setRepostBusy(true);
    try {
      const res = await api.toggleRepost(trackId);
      setReposted(res.reposted);
      setReposts(res.reposts);
    } catch {
      /* ignore */
    } finally {
      setRepostBusy(false);
    }
  };

  const seekTo = (t: number) => {
    if (!track) return;
    setCommentTs(Math.min(Math.max(t, 0), track.duration || 0));
    if (player.current?.id === track.id) player.seek(t);
    else player.playTrackAt(track, t);
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showNotice('Link copied to clipboard', 'success');
    } catch {
      showNotice('Could not copy the link');
    }
  };

  const pinCommentToNow = () => {
    if (!track) return;
    if (player.current?.id === track.id) setCommentTs(player.progress);
    else setCommentTs(0);
    commentInputRef.current?.focus();
  };

  const submitComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || commentBusy) {
      if (!user) showNotice('Log in to comment');
      return;
    }
    const body = commentBody.trim();
    if (!body) return;
    setCommentBusy(true);
    try {
      const res = await api.postComment(trackId, { body, ts: commentTs, replyTo });
      setComments((prev) => (commentFilter === 'oldest' ? [...prev, res.comment] : [res.comment, ...prev]));
      setCommentBody('');
      setReplyTo(null);
      showNotice('Comment posted');
    } catch {
      showNotice('Could not post the comment');
    } finally {
      setCommentBusy(false);
    }
  };

  const startReply = (c: Comment) => {
    setReplyTo(c.id);
    setCommentBody(`@${c.user.username} `);
    commentInputRef.current?.focus();
  };

  const cancelReply = () => {
    setReplyTo(null);
    setCommentBody('');
  };

  const toggleCommentLike = async (c: Comment) => {
    if (!user) {
      showNotice('Log in to like comments');
      return;
    }
    try {
      const res = await api.likeComment(c.id);
      setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, liked: res.liked, likes: res.likes } : x)));
    } catch {
      /* ignore */
    }
  };

  const removeComment = async (c: Comment) => {
    if (deletingId) return;
    if (!window.confirm('Delete this comment?')) return;
    setDeletingId(c.id);
    try {
      await api.deleteComment(c.id);
      setComments((prev) => prev.filter((x) => x.id !== c.id));
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  const toggleFollow = async () => {
    if (!user || !profile || followBusy) {
      if (!user) showNotice('Log in to follow');
      return;
    }
    setFollowBusy(true);
    try {
      const res = await api.toggleFollow(profile.id);
      setProfile((p) => (p ? { ...p, isFollowing: res.following, followers: res.followers } : p));
    } catch {
      /* ignore */
    } finally {
      setFollowBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <Skeleton className="h-80 rounded-xl" />
        <div className="mt-8 grid lg:grid-cols-[1fr_340px] gap-8">
          <div className="space-y-4">
            <Skeleton className="h-4 w-1/3 rounded" />
            <Skeleton className="h-64 rounded-lg" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="py-24 flex flex-col items-center gap-4 text-center">
        <Lock className="w-10 h-10 text-neutral-700" />
        <h2 className="text-lg font-semibold text-neutral-100">Awaiting moderation</h2>
        <p className="text-sm text-neutral-500 max-w-sm">
          This track is still in the review queue. Only the uploader and admins can see it.
        </p>
        <Link to="/" className="text-sm font-medium text-neutral-100 hover:underline mt-2">
          Back to feed
        </Link>
      </div>
    );
  }

  if (!track || notFound) {
    return (
      <div className="py-24 flex flex-col items-center gap-4 text-center">
        <ArrowLeft className="w-8 h-8 text-neutral-700" />
        <h2 className="text-lg font-semibold text-neutral-100">Track not found</h2>
        <Link to="/" className="text-sm font-medium text-neutral-100 hover:underline">
          Back to feed
        </Link>
      </div>
    );
  }

  const isCurrent = player.current?.id === track.id;
  const isCurrentPlaying = isCurrent && player.isPlaying;
  const isSuspended = track.status === 'suspended';

  const playThis = () => {
    if (isCurrent) player.togglePlay();
    else player.playTrack(track);
  };

  const actionBtn =
    'inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full border press';
  const actionBtnIdle = 'border-neutral-800 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600';
  const actionBtnActive = 'border-neutral-600 bg-neutral-900 text-neutral-100';

  const timestampLabel = (ts: number) => formatTime(ts);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {/* ============ HERO ============ */}
      <div className="relative overflow-hidden rounded-xl border border-neutral-900">
        <div className="absolute inset-0">
          {track.coverUrl ? (
            <img
              src={track.coverUrl}
              alt=""
              className="w-full h-full object-cover scale-110 blur-2xl brightness-[0.35]"
            />
          ) : (
            <div className="w-full h-full bg-neutral-900" />
          )}
          <div className="absolute inset-0 bg-neutral-950/60" />
        </div>

        <div className="relative z-10 p-5 sm:p-7">
          {/* tags */}
          <div className="sf-fade-up flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-neutral-400">
            {track.genre && (
              <span className="px-2 py-0.5 rounded border border-neutral-700/70 bg-neutral-900/70 text-neutral-300 normal-case tracking-normal">
                {track.genre}
              </span>
            )}
            <span>{timeAgo(track.createdAt)}</span>
            {qualityTier(track) !== 'standard' && (
              <span className="px-2 py-0.5 rounded-sm bg-neutral-800 text-neutral-200 font-semibold normal-case tracking-normal">
                {QUALITY_TIER_LABEL[qualityTier(track)]}
              </span>
            )}
            {(track.status === 'verified' || track.status === 'approved' || track.status === 'suspended') && (
              <span className="inline-flex items-center gap-1.5 normal-case tracking-normal text-neutral-300">
                <TrackMark status={track.status} />
                <span className="font-medium">
                  {track.status === 'approved' ? 'Approved' : track.status === 'suspended' ? 'Suspended' : 'Verified'}
                </span>
              </span>
            )}
            {track.source === 'soundcloud' && (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 normal-case tracking-normal">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-neutral-800 text-neutral-200 font-semibold">
                  <CloudDownload className="w-3.5 h-3.5" /> Imported from SoundCloud
                </span>
                {track.uploader?.id && (
                  <Link to={`/user/${track.uploader.id}`} className="text-neutral-400 hover:text-neutral-200 hover:underline">
                    by {track.uploader.username}
                  </Link>
                )}
                {track.sourceUrl && (
                  <a
                    href={track.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-neutral-400 hover:text-neutral-200 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" /> View on SoundCloud
                  </a>
                )}
              </span>
            )}
          </div>

          {/* title + play */}
          <div
            className="sf-fade-up mt-4 flex items-start gap-4 min-w-0"
            style={{ animationDelay: reduced ? undefined : '90ms' }}
          >
            <motion.button
              onClick={playThis}
              disabled={isSuspended}
              whileTap={{ scale: 0.88 }}
              className="w-14 h-14 shrink-0 flex items-center justify-center rounded-full bg-neutral-100 text-neutral-950 disabled:bg-neutral-900 disabled:text-neutral-600 disabled:cursor-not-allowed"
              title={isSuspended ? 'Playback suspended' : undefined}
            >
              {isSuspended ? (
                <Play className="w-6 h-6 fill-current" />
              ) : isCurrentPlaying ? (
                <Pause className="w-6 h-6 fill-current" />
              ) : (
                <Play className="w-6 h-6 fill-current ml-1" />
              )}
            </motion.button>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-100 leading-tight">
                {track.title}
              </h1>
              {track.uploader?.id ? (
                <Link
                  to={`/user/${track.uploader.id}`}
                  className="text-base text-neutral-400 hover:text-neutral-200 hover:underline mt-1 inline-block"
                >
                  {track.artist}
                </Link>
              ) : (
                <span className="text-base text-neutral-400 mt-1 inline-block">{track.artist}</span>
              )}
            </div>
          </div>

          {/* waveform */}
          <div className="sf-fade-up mt-4" style={{ animationDelay: reduced ? undefined : '180ms' }}>
            <Waveform
              trackId={track.id}
              audioUrl={track.audioUrl}
              duration={track.duration}
              comments={comments.map((c) => ({
                ts: c.ts,
                avatarUrl: c.user.avatarUrl,
                username: c.user.username,
              }))}
              onSeek={seekTo}
            />
          </div>

          {isSuspended && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-200/90">
                This track is temporarily <span className="font-medium">suspended</span> — playback and download are
                disabled. It may be reinstated by the moderators.
              </p>
            </motion.div>
          )}

          {/* comment input */}
          <form
            onSubmit={submitComment}
            className="sf-fade-up mt-4 flex items-center gap-2"
            style={{ animationDelay: reduced ? undefined : '240ms' }}
          >
            <button
              type="button"
              onClick={pinCommentToNow}
              className="shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-300 bg-neutral-900/80 border border-neutral-700 hover:border-neutral-500 px-3.5 py-2 rounded-lg press tabular-nums"
              title="Comment timestamp (click to pin to current position)"
            >
              {timestampLabel(commentTs)}
            </button>
            <input
              ref={commentInputRef}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder={user ? (replyTo ? 'Reply...' : 'Comment at this second...') : 'Log in to comment'}
              disabled={!user}
              className="flex-1 min-w-0 bg-neutral-900/80 border border-neutral-800 focus:border-neutral-600 rounded-lg px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!user || !commentBody.trim() || commentBusy}
              className="shrink-0 inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-neutral-100 text-neutral-950 hover:bg-neutral-300 press disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
          {replyTo && (
            <div className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
              <span>Replying to comment</span>
              <button onClick={cancelReply} className="inline-flex items-center gap-1 text-neutral-300 hover:text-neutral-100">
                <X className="w-3 h-3" /> Cancel
              </button>
            </div>
          )}

          {/* actions */}
          <div
            className="sf-fade-up mt-4 flex flex-wrap items-center gap-2"
            style={{ animationDelay: reduced ? undefined : '300ms' }}
          >
            <motion.button
              onClick={toggleLike}
              disabled={!user || likeBusy}
              whileTap={{ scale: 0.94 }}
              className={`${actionBtn} ${liked ? actionBtnActive : actionBtnIdle} disabled:opacity-40`}
            >
              <motion.span
                key={liked ? 'on' : 'off'}
                animate={liked ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                transition={{ duration: 0.35 }}
                className="flex items-center"
              >
                <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
              </motion.span>
              <motion.span
                key={likes}
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="tabular-nums"
              >
                {formatCount(likes)}
              </motion.span>
            </motion.button>
            <button onClick={share} className={`${actionBtn} ${actionBtnIdle}`}>
              <Share2 className="w-4 h-4" /> Share
            </button>
            <button
              onClick={toggleRepost}
              disabled={repostBusy}
              className={`${actionBtn} ${reposted ? actionBtnActive : actionBtnIdle}`}
              title={reposted ? 'Undo repost' : 'Repost'}
            >
              <Repeat className={`w-4 h-4 ${reposted ? '' : ''}`} />
              <motion.span
                key={reposts}
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="tabular-nums"
              >
                {formatCount(reposts)}
              </motion.span>
            </button>
            <button
              onClick={() => showNotice('Playlists arrive in the next update')}
              className={`${actionBtn} ${actionBtnIdle}`}
            >
              <ListPlus className="w-4 h-4" /> Playlist
            </button>
            <button
              onClick={() => {
                const reason = downloadGateReason(track, user);
                if (reason) return showNotice(reason);
                downloadTrack(track);
              }}
              disabled={isSuspended}
              className={`${actionBtn} ${actionBtnIdle} disabled:opacity-40 disabled:cursor-not-allowed`}
              title={downloadGateReason(track, user) ?? 'Download track'}
            >
              <Download className="w-4 h-4" /> Download
            </button>
          </div>
        </div>
      </div>

      {/* ============ BODY ============ */}
      <div className="mt-8 grid lg:grid-cols-[minmax(0,1fr)_340px] gap-8 items-start">
        {/* LEFT */}
        <div className="space-y-8 min-w-0">
          {/* DETAILS */}
          <section>
            <h2 className="text-xs font-semibold text-neutral-400 mb-3">Details</h2>
            <div className="rounded-lg border border-neutral-900 bg-neutral-950 p-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-neutral-500">License</span>
                <span className="text-neutral-200 font-medium capitalize">{track.license}</span>
              </div>
              <div className="flex items-center justify-between gap-4 text-sm mt-2">
                <span className="text-neutral-500">Uploaded</span>
                <span className="text-neutral-200 font-medium">{timeAgo(track.createdAt)}</span>
              </div>
              {track.bitrate > 0 && (
                <div className="flex items-center justify-between gap-4 text-sm mt-2">
                  <span className="text-neutral-500">Quality</span>
                  <span className="text-neutral-200 font-medium">{formatQuality(track.sampleRate, track.bitDepth, track.bitrate)}</span>
                </div>
              )}
              {track.description && (
                <p className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap mt-4 pt-4 border-t border-neutral-900">
                  {track.description}
                </p>
              )}
            </div>
          </section>

          {/* COMMENTS */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-neutral-400">
                Comments <span className="ml-1 text-neutral-500">{comments.length}</span>
              </h2>
              <select
                value={commentFilter}
                onChange={(e) => setCommentFilter(e.target.value as 'newest' | 'oldest')}
                className="bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 rounded-md px-2 py-1 focus:outline-none focus:border-neutral-600"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>

            {comments.length === 0 ? (
              <div className="rounded-lg border border-neutral-900 p-8 text-center">
                <p className="text-sm text-neutral-500">No comments yet. Leave the first one!</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {comments.map((c) => {
                  const canDelete = user && (user.id === c.user.id || user.role === 'admin' || user.role === 'owner');
                  return (
                    <div key={c.id} className="flex gap-3 rounded-lg px-3 py-2.5 hover:bg-neutral-900 transition-colors">
                      <Avatar url={c.user.avatarUrl} name={c.user.username} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="font-medium text-neutral-200">@{c.user.username}</span>
                          <button
                            onClick={() => seekTo(c.ts)}
                            className="font-semibold text-neutral-400 hover:text-neutral-100 tabular-nums transition-colors"
                          >
                            {formatTime(c.ts)}
                          </button>
                          <span className="text-neutral-600">·</span>
                          <span className="text-neutral-600">{timeAgo(c.createdAt)}</span>
                        </div>
                        <p className="text-sm text-neutral-300 mt-1 leading-relaxed">{c.body}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <button
                            onClick={() => toggleCommentLike(c)}
                            className={`inline-flex items-center gap-1 text-xs transition-colors ${
                              c.liked ? 'text-neutral-100' : 'text-neutral-500 hover:text-neutral-200'
                            }`}
                          >
                            <Heart className={`w-3.5 h-3.5 ${c.liked ? 'fill-current' : ''}`} />
                            {c.likes > 0 && <span className="tabular-nums">{formatCount(c.likes)}</span>}
                          </button>
                          <button
                            onClick={() => startReply(c)}
                            className="text-xs font-medium text-neutral-500 hover:text-neutral-200 transition-colors"
                          >
                            Reply
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => removeComment(c)}
                              disabled={deletingId === c.id}
                              className="text-xs text-neutral-600 hover:text-red-400 transition-colors disabled:opacity-40"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT SIDEBAR */}
        <aside className="space-y-6 min-w-0">
          {profile && (
            <div className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
              <div className="flex items-center gap-4">
                <Avatar url={profile.avatar_url} name={profile.username} />
                <div className="min-w-0">
                  <Link to={`/user/${profile.id}`} className="block">
                    <h3 className="text-base font-semibold text-neutral-100 truncate hover:underline">
                      {profile.username}
                    </h3>
                  </Link>
                  {profile.location && (
                    <p className="text-xs text-neutral-500 flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3 shrink-0" /> {profile.location}
                    </p>
                  )}
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {formatCount(profile.followers)} followers · {formatCount(profile.trackCount)} tracks
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={toggleFollow}
                  disabled={followBusy || !user}
                  className={`flex-1 text-sm font-medium px-4 py-2 rounded-full border press ${
                    profile.isFollowing
                      ? 'border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-100'
                      : 'bg-neutral-100 text-neutral-950 hover:bg-neutral-300 border-transparent'
                  } disabled:opacity-40`}
                >
                  {profile.isFollowing ? 'Following' : 'Follow'}
                </button>
                <button
                  onClick={() => showNotice('Messages arrive in the next update')}
                  className="flex-1 inline-flex items-center justify-center gap-2 text-sm font-medium px-4 py-2 rounded-full border border-neutral-800 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 press"
                >
                  <MessageCircle className="w-4 h-4" /> Message
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
            <h2 className="text-xs font-semibold text-neutral-400 mb-4">
              Track stats
            </h2>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Plays</span>
                <span className="text-sm font-semibold text-neutral-100 tabular-nums">{formatCount(track.plays)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Likes</span>
                <span className="text-sm font-semibold text-neutral-100 tabular-nums">{formatCount(likes)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500">Reposts</span>
                <span className="text-sm font-semibold text-neutral-100 tabular-nums">{formatCount(reposts)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-900 bg-neutral-950 p-5">
            <h2 className="text-xs font-semibold text-neutral-400 mb-4">
              Fans
            </h2>
            {fans.length === 0 ? (
              <div className="text-center py-6">
                <Users className="w-7 h-7 text-neutral-700 mx-auto mb-2" />
                <p className="text-xs text-neutral-600">
                  Top listeners will appear here as people play this track.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {fans.map((f, i) => (
                  <div key={f.user.id} className="flex items-center gap-3">
                    <span className="w-5 text-center text-xs font-bold text-neutral-500 tabular-nums">{i + 1}</span>
                    <Avatar url={f.user.avatarUrl} name={f.user.username} size="sm" />
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/user/${f.user.id}`}
                        className="text-sm text-neutral-200 hover:text-neutral-100 hover:underline truncate block"
                      >
                        {f.user.username}
                      </Link>
                      <span className="text-xs text-neutral-600 flex items-center gap-1">
                        <Music2 className="w-3 h-3" /> {formatCount(f.plays)} plays
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </motion.div>
  );
}
