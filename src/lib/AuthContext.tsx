import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { api, ApiError, LoginResult } from './api';
import type { User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  login2fa: (userId: number, code: string) => Promise<string[] | null>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(({ user }) => {
        if (!cancelled) setUser(user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    if (!('need2fa' in result)) setUser(result.user);
    return result;
  }, []);

  const login2fa = useCallback(async (userId: number, code: string) => {
    const { user, recoveryCodes } = await api.login2fa(userId, code);
    setUser(user);
    return recoveryCodes ?? null;
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const { user } = await api.register(username, email, password);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const { user } = await api.me();
    setUser(user);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, login2fa, register, logout, refresh }),
    [user, loading, login, login2fa, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
