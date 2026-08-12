import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './AuthContext';
import { playChime, notificationsSoundEnabled } from './notificationSound';
import type { AppNotification } from '../types';

interface NotificationsContextValue {
  items: AppNotification[];
  unread: number;
  loading: boolean;
  refresh: () => void;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  clearAll: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

function shouldChime(prev: number | null, unread: number): boolean {
  return prev !== null && unread > prev && notificationsSoundEnabled();
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevUnreadRef = useRef<number | null>(null);

  const refresh = useCallback(() => {
    if (!user) {
      prevUnreadRef.current = null;
      return;
    }
    setLoading(true);
    Promise.all([api.notifications(), api.notificationsUnread()])
      .then(([list, count]) => {
        setItems(list.notifications);
        if (shouldChime(prevUnreadRef.current, count.unread)) playChime();
        prevUnreadRef.current = count.unread;
        setUnread(count.unread);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    timerRef.current = setInterval(refresh, 30000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [user, refresh]);

  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onFocus = () => refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, refresh]);

  const markRead = useCallback(async (id: number) => {
    await api.readNotification(id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    prevUnreadRef.current = Math.max(0, (prevUnreadRef.current ?? 0) - 1);
  }, []);

  const markAllRead = useCallback(async () => {
    await api.readAllNotifications();
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    prevUnreadRef.current = 0;
  }, []);

  const clearAll = useCallback(async () => {
    await api.clearNotifications();
    setItems([]);
    setUnread(0);
    prevUnreadRef.current = 0;
  }, []);

  const value = useMemo(
    () => ({ items, unread, loading, refresh, markRead, markAllRead, clearAll }),
    [items, unread, loading, refresh, markRead, markAllRead, clearAll],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider');
  return ctx;
}
