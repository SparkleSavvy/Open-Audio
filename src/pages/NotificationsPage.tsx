import { useState } from 'react';
import { Link } from 'react-router';
import { Bell, Check, X, AlertTriangle, Play, Trash2, CheckCheck, Volume2, VolumeX, MessageSquare, Megaphone } from 'lucide-react';
import { useNotifications } from '../lib/NotificationsContext';
import { notificationsSoundEnabled, setNotificationsSoundEnabled } from '../lib/notificationSound';
import { timeAgo } from '../lib/format';
import type { NotificationType } from '../types';

const ICONS: Record<NotificationType, { icon: typeof Check; className: string }> = {
  track_verified: { icon: Check, className: 'bg-emerald-500/15 text-emerald-400' },
  track_rejected: { icon: X, className: 'bg-red-500/15 text-red-400' },
  track_suspended: { icon: AlertTriangle, className: 'bg-amber-500/15 text-amber-400' },
  track_unsuspended: { icon: Play, className: 'bg-emerald-500/15 text-emerald-400' },
  track_deleted: { icon: Trash2, className: 'bg-neutral-700/30 text-neutral-300' },
  track_comment: { icon: MessageSquare, className: 'bg-neutral-500/15 text-neutral-300' },
  admin_message: { icon: Megaphone, className: 'bg-neutral-500/15 text-neutral-300' },
};

export default function NotificationsPage() {
  const { items, unread, loading, markRead, markAllRead, clearAll } = useNotifications();
  const [busyAll, setBusyAll] = useState(false);
  const [busyClear, setBusyClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(() => notificationsSoundEnabled());

  const handleAll = async () => {
    setBusyAll(true);
    setError(null);
    try {
      await markAllRead();
    } catch {
      setError('Could not mark notifications as read');
    } finally {
      setBusyAll(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Clear all notifications? This cannot be undone.')) return;
    setBusyClear(true);
    setError(null);
    try {
      await clearAll();
    } catch {
      setError('Could not clear notifications');
    } finally {
      setBusyClear(false);
    }
  };

  const toggleSound = () => {
    setSoundOn((s) => {
      setNotificationsSoundEnabled(!s);
      return !s;
    });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-neutral-300" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Notifications</h1>
            <p className="text-sm text-neutral-400 mt-0.5">Updates about your uploaded tracks</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSound}
            className="inline-flex items-center justify-center w-8 h-8 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 rounded-full border border-neutral-800 hover:border-neutral-600 transition-colors"
            title={soundOn ? 'Notification sound: on' : 'Notification sound: off'}
          >
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          {unread > 0 && (
            <button
              onClick={handleAll}
              disabled={busyAll}
              className="inline-flex items-center gap-2 text-xs font-medium text-neutral-300 hover:text-neutral-100 border border-neutral-800 hover:border-neutral-600 rounded-full px-3.5 py-1.5 transition-colors disabled:opacity-40"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all as read
            </button>
          )}
          {items.length > 0 && (
            <button
              onClick={handleClear}
              disabled={busyClear}
              className="inline-flex items-center gap-2 text-xs font-medium text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 rounded-full px-3.5 py-1.5 transition-colors disabled:opacity-40"
              title="Delete all notifications"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear all
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-neutral-900 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-24 text-center">
          <Bell className="w-10 h-10 text-neutral-700 mx-auto mb-3" />
          <p className="text-sm text-neutral-500">No notifications yet.</p>
          <p className="text-xs text-neutral-600 mt-1">
            You'll be notified when your tracks are verified, rejected, suspended or deleted.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {items.map((n) => {
            const { icon: Icon, className } = ICONS[n.type] ?? ICONS.track_deleted;
            const inner = (
              <>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${className}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${n.read ? 'text-neutral-400' : 'text-neutral-100'}`}>
                    {n.message}
                  </p>
                  <p className="text-xs text-neutral-600 mt-0.5">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.read && <span className="w-2 h-2 rounded-full bg-neutral-100 shrink-0" />}
              </>
            );
            const cls = `group flex items-center gap-4 rounded-lg px-3 py-2.5 transition-colors ${
              n.read ? 'bg-transparent' : 'bg-neutral-900'
            } ${n.trackId != null ? 'cursor-pointer hover:bg-neutral-900' : ''}`;
            return n.trackId != null ? (
              <Link
                key={n.id}
                to={`/track/${n.trackId}`}
                onClick={() => !n.read && markRead(n.id).catch(() => {})}
                className={cls}
              >
                {inner}
              </Link>
            ) : (
              <div key={n.id} className={cls}>
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
