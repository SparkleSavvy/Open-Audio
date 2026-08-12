import { useEffect, useState, useCallback, FormEvent } from 'react';
import type { ReactNode } from 'react';
import {
  ShieldCheck,
  Check,
  X,
  Ban,
  RotateCcw,
  UserCheck,
  BarChart3,
  Users,
  AudioLines,
  Loader2,
  Trash2,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  Star,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import type { Track, AdminUser, AdminStats, RemovalRequest, TrackDeleteRequest } from '../types';
import TrackListRow from '../components/TrackListRow';
import { formatCount, timeAgo } from '../lib/format';

type Tab = 'moderation' | 'users' | 'stats' | 'deleteRequests' | 'danger';
type StatusFilter = 'pending' | 'verified' | 'suspended' | 'rejected';

/* ---------------- Moderation ---------------- */

function ModerationPanel() {
  const { user } = useAuth();
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [tracksByStatus, setTracksByStatus] = useState<Partial<Record<StatusFilter, Track[]>>>({});
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [requestingId, setRequestingId] = useState<number | null>(null);
  const [requestReason, setRequestReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback((s: StatusFilter) => {
    setLoading(true);
    api
      .adminTracks(s)
      .then(({ tracks }) => setTracksByStatus((prev) => ({ ...prev, [s]: tracks })))
      .catch(() => setTracksByStatus((prev) => ({ ...prev, [s]: [] })))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(status), [status, load]);

  const tracks = tracksByStatus[status];
  const isOwner = user?.role === 'owner';

  const runAction = async (id: number, action: () => Promise<unknown>) => {
    if (busyId === id) return;
    setBusyId(id);
    setError(null);
    try {
      await action();
      load(status);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed — try again');
    } finally {
      setBusyId(null);
      setRejectingId(null);
      setReason('');
      setRequestingId(null);
      setRequestReason('');
    }
  };

  const remove = (track: Track) => {
    if (!window.confirm(`Delete "${track.title}" permanently? This cannot be undone.`)) return;
    runAction(track.id, () => api.adminDeleteTrack(track.id).then(() => undefined));
  };

  const requestDelete = (track: Track) => {
    runAction(track.id, async () => {
      const reason = requestReason.trim();
      const { request } = await api.requestTrackDelete(track.id, reason);
      setNotice(
        `Delete request #${request.id} for "${track.title}" sent to the owner for approval.`,
      );
    });
  };

  return (
    <div>
      <div className="flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900 p-1 w-fit mb-6">
        {(['pending', 'verified', 'suspended', 'rejected'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
              status === s ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-400 hover:text-neutral-100'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {notice && (
        <p className="mb-4 text-sm text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-2.5">
          {notice}
        </p>
      )}

      {error && (
        <p className="mb-4 text-sm text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}

      {tracks === undefined ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-neutral-900 animate-pulse" />
          ))}
        </div>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={status}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {tracks.length === 0 ? (
              <div className="py-16 text-center text-sm text-neutral-500">No {status} tracks.</div>
            ) : (
              <div className="flex flex-col gap-1">
          {tracks.map((track) => (
            <div key={track.id} className="rounded-lg border border-transparent hover:border-neutral-800">
              <TrackListRow
                track={track}
                showStatus
                extra={
                  <div className="flex items-center gap-2 shrink-0">
                    {(status === 'pending' || status === 'rejected') && (
                      <button
                        onClick={() =>
                          runAction(track.id, () => api.verifyTrack(track.id).then(() => undefined))
                        }
                        disabled={busyId === track.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded-full px-3 py-1 transition-colors disabled:opacity-40"
                      >
                        <Check className="w-3.5 h-3.5" /> Verify
                      </button>
                    )}
                    {status === 'pending' && (
                      <button
                        onClick={() => setRejectingId(rejectingId === track.id ? null : track.id)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 rounded-full px-3 py-1 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" /> Reject
                      </button>
                    )}
                    {status === 'verified' && (
                      <button
                        onClick={() =>
                          runAction(track.id, () => api.suspendTrack(track.id).then(() => undefined))
                        }
                        disabled={busyId === track.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 hover:text-amber-200 border border-amber-500/30 hover:border-amber-500/60 rounded-full px-3 py-1 transition-colors disabled:opacity-40"
                        title="Temporarily disable playback"
                      >
                        <PauseCircle className="w-3.5 h-3.5" /> Suspend
                      </button>
                    )}
                    {status === 'suspended' && (
                      <button
                        onClick={() =>
                          runAction(track.id, () => api.unsuspendTrack(track.id).then(() => undefined))
                        }
                        disabled={busyId === track.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded-full px-3 py-1 transition-colors disabled:opacity-40"
                        title="Re-enable playback"
                      >
                        <PlayCircle className="w-3.5 h-3.5" /> Unsuspend
                      </button>
                    )}
                    {!isOwner && (
                      <button
                        onClick={() => setRequestingId(requestingId === track.id ? null : track.id)}
                        disabled={busyId === track.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 rounded-full px-3 py-1 transition-colors disabled:opacity-40"
                        title="Request the owner to delete this track"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Request delete
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => remove(track)}
                        disabled={busyId === track.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 rounded-full px-3 py-1 transition-colors disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                  </div>
                }
              />
              {requestingId === track.id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="px-14 pb-3"
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      requestDelete(track);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={requestReason}
                      onChange={(e) => setRequestReason(e.target.value)}
                      placeholder="Reason for the owner (e.g. DMCA, duplicate, invalid content)"
                      autoFocus
                      className="flex-1 px-3 py-1.5 rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-red-500/40 transition-colors text-xs"
                    />
                    <button
                      type="submit"
                      disabled={busyId === track.id}
                      className="text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1.5 transition-colors disabled:opacity-40"
                    >
                      {busyId === track.id ? 'Sending…' : 'Send request'}
                    </button>
                  </form>
                </motion.div>
              )}
              {rejectingId === track.id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="px-14 pb-3"
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (reason.trim()) runAction(track.id, () => api.rejectTrack(track.id, reason.trim()).then(() => undefined));
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason for rejection (shown to the uploader)"
                      autoFocus
                      className="flex-1 px-3 py-1.5 rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-red-500/40 transition-colors text-xs"
                    />
                    <button
                      type="submit"
                      disabled={busyId === track.id || !reason.trim()}
                      className="text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1.5 transition-colors disabled:opacity-40"
                    >
                      {busyId === track.id ? 'Rejecting…' : 'Reject'}
                    </button>
                  </form>
                </motion.div>
              )}
            </div>
          ))}
            </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

/* ---------------- Users ---------------- */

function UsersPanel() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .adminUsers()
      .then(({ users }) => setUsers(users))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const update = async (id: number, patch: { banned?: boolean; role?: string; supporter?: boolean }) => {
    setBusyId(id);
    setError(null);
    try {
      await api.updateUser(id, patch);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed — try again');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-neutral-900 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {error && (
        <p className="mb-3 text-sm text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-2.5">{error}</p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500 border-b border-neutral-800">
            <th className="py-3 pr-4 font-medium">User</th>
            <th className="py-3 pr-4 font-medium hidden md:table-cell">Role</th>
            <th className="py-3 pr-4 font-medium hidden sm:table-cell">Joined</th>
            <th className="py-3 pr-4 font-medium text-right">Tracks</th>
            <th className="py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={`border-b border-neutral-900 ${u.banned ? 'opacity-50' : ''}`}>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-xs font-semibold text-neutral-300 uppercase">
                    {u.username.slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-neutral-100 font-medium truncate">
                      {u.username} {u.banned && <span className="text-red-400 text-xs font-normal">(banned)</span>}
                    </p>
                    {u.email && <p className="text-xs text-neutral-500 truncate">{u.email}</p>}
                  </div>
                </div>
              </td>
              <td className="py-3 pr-4 hidden md:table-cell">
                <span
                  className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                    u.role === 'owner'
                      ? 'bg-amber-500/15 text-amber-300'
                      : u.role === 'admin'
                        ? 'bg-neutral-100 text-neutral-950'
                        : 'bg-neutral-900 text-neutral-400'
                  }`}
                >
                  {u.role}
                </span>
              </td>
              <td className="py-3 pr-4 text-neutral-500 hidden sm:table-cell">{timeAgo(u.created_at)}</td>
              <td className="py-3 pr-4 text-right text-neutral-400 tabular-nums">{u.trackCount}</td>
              <td className="py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  {isOwner && u.role === 'user' && (
                    <button
                      onClick={() => update(u.id, { role: 'admin' })}
                      disabled={busyId === u.id}
                      className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-100 border border-neutral-800 rounded-full px-2.5 py-1 transition-colors disabled:opacity-40"
                      title="Promote to admin"
                    >
                      <UserCheck className="w-3.5 h-3.5" /> Promote
                    </button>
                  )}
                  {isOwner && u.role === 'admin' && (
                    <button
                      onClick={() => update(u.id, { role: 'user' })}
                      disabled={busyId === u.id}
                      className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-200 border border-neutral-800 rounded-full px-2.5 py-1 transition-colors disabled:opacity-40"
                      title="Demote"
                    >
                      Demote
                    </button>
                  )}
                  {isOwner && (
                    <button
                      onClick={() => update(u.id, { supporter: !u.supporter })}
                      disabled={busyId === u.id}
                      className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 border transition-colors disabled:opacity-40 ${
                        u.supporter
                          ? 'bg-neutral-100 text-neutral-950 border-transparent hover:bg-neutral-300'
                          : 'text-neutral-500 border-neutral-800 hover:text-neutral-100'
                      }`}
                      title={u.supporter ? 'Revoke supporter badge' : 'Grant supporter badge (unlocks FLAC downloads)'}
                    >
                      <Star className="w-3.5 h-3.5" /> {u.supporter ? 'Supporter' : 'Support'}
                    </button>
                  )}
                  <button
                    onClick={() => update(u.id, { banned: !u.banned })}
                    disabled={busyId === u.id}
                    className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 border transition-colors disabled:opacity-40 ${
                      u.banned
                        ? 'text-emerald-300 border-emerald-500/30 hover:border-emerald-500/60'
                        : 'text-red-400 border-red-500/30 hover:border-red-500/60'
                    }`}
                  >
                    {u.banned ? (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" /> Unban
                      </>
                    ) : (
                      <>
                        <Ban className="w-3.5 h-3.5" /> Ban
                      </>
                    )}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Stats ---------------- */

function StatsPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .adminStats()
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-neutral-500 animate-spin" />
      </div>
    );
  }

  const o = stats.overview;
  const cards = [
    { label: 'Total tracks', value: o.totalTracks },
    { label: 'Pending review', value: o.pendingTracks },
    { label: 'Verified', value: o.verifiedTracks },
    { label: 'Suspended', value: o.suspendedTracks },
    { label: 'Rejected', value: o.rejectedTracks },
    { label: 'Users', value: o.totalUsers },
    { label: 'Banned users', value: o.bannedUsers },
    { label: 'Total plays', value: formatCount(o.totalPlays) },
    { label: 'Total likes', value: formatCount(o.totalLikes) },
  ];

  const maxDay = Math.max(1, ...stats.recentUploads.map((r) => r.count));
  const maxPlays = Math.max(1, ...stats.topTracks.map((t) => t.plays));

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4"
          >
            <p className="text-xs text-neutral-500">{c.label}</p>
            <p className="text-2xl font-bold text-neutral-100 mt-1 tabular-nums">{c.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
          <h3 className="text-sm font-medium text-neutral-300 mb-4">Uploads — last 14 days</h3>
          {stats.recentUploads.length === 0 ? (
            <p className="text-sm text-neutral-600">No uploads in this period.</p>
          ) : (
            <div className="flex items-end gap-1.5 h-32">
              {stats.recentUploads.map((r) => (
                <div key={r.day} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className="text-[10px] text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                    {r.count}
                  </span>
                  <div
                    className="w-full bg-neutral-700 group-hover:bg-neutral-400 transition-colors rounded-t-sm"
                    style={{ height: `${(r.count / maxDay) * 100}%` }}
                  />
                  <span className="text-[9px] text-neutral-600">{r.day.slice(8)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
          <h3 className="text-sm font-medium text-neutral-300 mb-4">Top tracks by plays</h3>
          {stats.topTracks.length === 0 ? (
            <p className="text-sm text-neutral-600">No published tracks yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {stats.topTracks.map((t, i) => (
                <div key={t.id} className="flex items-center gap-3">
                  <span className="w-5 text-xs text-neutral-600 tabular-nums">{i + 1}</span>
                  <div className="w-10 h-10 rounded-sm bg-neutral-800 overflow-hidden shrink-0">
                    {t.coverUrl && <img src={t.coverUrl} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-neutral-300 font-medium truncate">
                        {t.title} <span className="text-neutral-500 font-normal">· {t.artist}</span>
                      </span>
                      <span className="text-neutral-500 shrink-0 ml-2 tabular-nums">{formatCount(t.plays)}</span>
                    </div>
                    <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
                      <div className="h-full bg-neutral-500" style={{ width: `${(t.plays / maxPlays) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Delete requests ---------------- */

function DeleteRequestsPanel() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [requests, setRequests] = useState<TrackDeleteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .trackDeleteRequests()
      .then(({ requests }) => setRequests(requests))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const decide = async (r: TrackDeleteRequest, approve: boolean) => {
    if (approve && !window.confirm(`Approve deleting "${r.trackTitle}" permanently? The audio file is removed.`)) return;
    setBusyId(r.id);
    setError(null);
    try {
      if (approve) {
        await api.approveTrackDelete(r.id);
        setNotice(`Track "${r.trackTitle}" deleted.`);
      } else {
        await api.rejectTrackDelete(r.id);
        setNotice(`Delete request for "${r.trackTitle}" rejected.`);
      }
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  };

  const pending = requests.filter((r) => r.status === 'pending');
  const history = requests.filter((r) => r.status !== 'pending');

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-neutral-900 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {!isOwner && (
        <p className="text-xs text-neutral-500 leading-relaxed">
          You can request a track deletion from the Moderation tab. Only the owner can approve or reject these
          requests — deleting tracks is not available to moderators.
        </p>
      )}

      <div>
        <h3 className="text-xs text-neutral-500 mb-3">
          Pending <span className="ml-1 text-neutral-600">({pending.length})</span>
        </h3>
        {pending.length === 0 ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-8 text-center">
            <p className="text-sm text-neutral-500">No pending delete requests.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {pending.map((r) => (
              <div key={r.id} className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-neutral-100 font-medium truncate">
                      {r.trackTitle} <span className="text-neutral-500 font-normal">· {r.trackArtist}</span>
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      requested by <span className="text-neutral-300">{r.requestedByUsername ?? 'unknown'}</span> ·{' '}
                      {timeAgo(r.createdAt)}
                    </p>
                    {r.reason && <p className="text-xs text-neutral-300 mt-2">“{r.reason}”</p>}
                  </div>
                  {isOwner ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => decide(r, true)}
                        disabled={busyId === r.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded-full px-3 py-1.5 transition-colors disabled:opacity-40"
                      >
                        {busyId === r.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        Approve & delete
                      </button>
                      <button
                        onClick={() => decide(r, false)}
                        disabled={busyId === r.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-300 hover:text-neutral-100 border border-neutral-700 rounded-full px-3 py-1.5 transition-colors disabled:opacity-40"
                      >
                        <X className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-amber-300/70 bg-amber-500/10 rounded-full px-2 py-0.5 shrink-0">
                      awaiting owner
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div>
          <h3 className="text-xs text-neutral-500 mb-3">History</h3>
          <div className="flex flex-col gap-2">
            {history.map((r) => (
              <div key={r.id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                      r.status === 'approved' ? 'bg-red-500/10 text-red-300' : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {r.status}
                  </span>
                  <span className="text-xs text-neutral-500">
                    decided {r.decidedAt ? timeAgo(r.decidedAt) : '—'}
                    {r.decidedByUsername ? ` by ${r.decidedByUsername}` : ''}
                  </span>
                </div>
                <p className="text-neutral-200 mt-2 truncate">
                  {r.trackTitle} <span className="text-neutral-500 font-normal">· {r.trackArtist}</span>
                </p>
                {r.reason && <p className="text-neutral-500 mt-1 text-xs">“{r.reason}”</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Danger zone (verified removal) ---------------- */

function DangerPanel() {
  const [requests, setRequests] = useState<RemovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [key, setKey] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api
      .adminRemovalRequests()
      .then(({ requests }) => setRequests(requests))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const pending = requests.find((r) => r.status === 'pending');
  const history = requests.filter((r) => r.status !== 'pending');

  const cancel = async (id: number) => {
    if (!window.confirm('Dismiss this removal request? The server will remain installed.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminCancelRemoval(id);
      setNotice('Removal request dismissed.');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (confirmingId === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminConfirmRemoval(confirmingId, key.trim());
      setNotice('Removal confirmed. The database, uploads, build and .env are being deleted — this server is shutting down.');
      setRequests((prev) =>
        prev.map((r) => (r.id === confirmingId ? { ...r, status: 'confirmed' as const } : r)),
      );
      setConfirmingId(null);
      setKey('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
        <div className="flex items-center gap-2 text-red-400 mb-1">
          <AlertTriangle className="w-4 h-4" />
          <h3 className="text-sm font-medium">Danger zone</h3>
        </div>
        <p className="text-xs text-neutral-400 leading-relaxed">
          The CLI utility (<code className="text-neutral-300">npm run admin remove-server</code>) can request a full server
          removal. Confirming permanently deletes the database, uploads, production build and <code className="text-neutral-300">.env</code>,
          then stops the process. It requires the REMOVAL_KEY that the setup utility generated.
        </p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-neutral-900 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {!pending && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 text-center">
              <p className="text-sm text-neutral-400">No pending removal requests.</p>
              <p className="text-xs text-neutral-600 mt-1">
                Run <code className="text-neutral-500">npm run admin remove-server</code> on the server to request one.
              </p>
            </div>
          )}

          {pending && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
              <div className="flex items-center justify-between gap-4 mb-3">
                <h3 className="text-sm font-medium text-amber-300">Pending removal request</h3>
                <span className="text-[10px] text-amber-300/80 bg-amber-500/10 rounded-full px-2 py-0.5">
                  awaiting confirmation
                </span>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
                <div>
                  <dt className="text-xs text-neutral-500">Server</dt>
                  <dd className="text-neutral-200 mt-0.5 break-words">{pending.server}</dd>
                </div>
                <div>
                  <dt className="text-xs text-neutral-500">Requested</dt>
                  <dd className="text-neutral-200 mt-0.5">{new Date(pending.requestedAt).toLocaleString()}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-neutral-500">Reason</dt>
                  <dd className="text-neutral-200 mt-0.5">{pending.reason || '—'}</dd>
                </div>
              </dl>

              {confirmingId !== pending.id ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmingId(pending.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-red-300 hover:text-red-200 border border-red-500/40 hover:border-red-500/70 rounded-full px-4 py-2 transition-colors disabled:opacity-40"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Confirm removal
                  </button>
                  <button
                    onClick={() => cancel(pending.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 border border-neutral-700 rounded-full px-4 py-2 transition-colors disabled:opacity-40"
                  >
                    <X className="w-3.5 h-3.5" /> Cancel request
                  </button>
                </div>
              ) : (
                <form onSubmit={confirm} className="flex flex-col gap-3">
                  <p className="text-xs text-red-300 leading-relaxed">
                    This permanently deletes the database, all uploads, the production build and <code>.env</code>. Enter the
                    REMOVAL_KEY shown by <code className="text-red-200">npm run setup</code> (or{' '}
                    <code className="text-red-200">npm run admin removal-key</code>) to proceed. This cannot be undone.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder="Removal key"
                      autoFocus
                      className="flex-1 px-3.5 py-2 rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-red-500/40 transition-colors text-sm"
                    />
                    <button
                      type="submit"
                      disabled={busy || !key.trim()}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-950 bg-red-400 hover:bg-red-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-full px-4 py-2 transition-colors"
                    >
                      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      disabled={busy}
                      className="text-xs text-neutral-500 hover:text-neutral-200 px-3 py-2 rounded-full transition-colors"
                    >
                      Back
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {history.length > 0 && (
            <div>
              <h3 className="text-xs text-neutral-500 mb-3">History</h3>
              <div className="flex flex-col gap-2">
                {history.map((r) => (
                  <div key={r.id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                          r.status === 'confirmed' ? 'bg-red-500/10 text-red-300' : 'bg-neutral-800 text-neutral-400'
                        }`}
                      >
                        {r.status}
                      </span>
                      <span className="text-xs text-neutral-500">
                        {r.status === 'confirmed'
                          ? `confirmed ${timeAgo(r.confirmedAt ?? r.requestedAt)}`
                          : `cancelled ${timeAgo(r.cancelledAt ?? r.requestedAt)}`}
                      </span>
                    </div>
                    <p className="text-neutral-400 mt-2 text-xs">{r.server}</p>
                    {r.reason && <p className="text-neutral-500 mt-1 text-xs">“{r.reason}”</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Page ---------------- */

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('moderation');

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'moderation', label: 'Moderation', icon: <AudioLines className="w-4 h-4" /> },
    { id: 'users', label: 'Users', icon: <Users className="w-4 h-4" /> },
    { id: 'deleteRequests', label: 'Delete requests', icon: <Trash2 className="w-4 h-4" /> },
    { id: 'stats', label: 'Stats', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'danger', label: 'Danger zone', icon: <AlertTriangle className="w-4 h-4" /> },
  ];

  return (
    <div>
      <div className="mb-8 flex items-center gap-3">
        <ShieldCheck className="w-6 h-6 text-neutral-300" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Admin panel</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Review submissions and manage the platform</p>
        </div>
      </div>

      <div className="flex items-center gap-1 rounded-full border border-neutral-800 bg-neutral-900 p-1 w-fit mb-8">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
              tab === t.id ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-400 hover:text-neutral-100'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'moderation' && <ModerationPanel />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'deleteRequests' && <DeleteRequestsPanel />}
      {tab === 'stats' && <StatsPanel />}
      {tab === 'danger' && <DangerPanel />}
    </div>
  );
}
