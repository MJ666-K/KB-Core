import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearAuthSession,
  getAuthToken,
  getRefreshToken,
  getStoredUser,
  saveAuthSession,
  type StoredUser,
} from './storage';

interface AuthState {
  user: StoredUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshIfNeeded: () => Promise<boolean>;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const AUTH_EXPIRED_EVENT = 'kc:auth-expired';

export function isAuthenticatedSession(): boolean {
  return Boolean(getAuthToken() && getStoredUser());
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  window.location.replace('/login');
}

function notifyAuthExpired(): void {
  clearAuthSession();
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  redirectToLogin();
}

async function authJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    const err = await r.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshingRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const refreshIfNeeded = useCallback(async (): Promise<boolean> => {
    if (refreshingRef.current) return refreshingRef.current;

    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;

    refreshingRef.current = authJson<{
      accessToken: string;
      refreshToken: string;
      user: StoredUser;
    }>('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).then(data => {
      saveAuthSession(data);
      setUser(data.user);
      return true;
    }).catch(() => false).finally(() => {
      refreshingRef.current = null;
    });

    return refreshingRef.current;
  }, []);

  const validateSession = useCallback(async (): Promise<boolean> => {
    let token = getAuthToken();
    if (!token) {
      clearAuthSession();
      setUser(null);
      return false;
    }

    if (getRefreshToken()) {
      const refreshed = await refreshIfNeeded();
      if (!refreshed) {
        clearAuthSession();
        setUser(null);
        return false;
      }
      token = getAuthToken();
    }

    if (!token) {
      clearAuthSession();
      setUser(null);
      return false;
    }

    try {
      const me = await authJson<{ user: StoredUser }>('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(me.user);
      saveAuthSession({
        accessToken: token,
        refreshToken: getRefreshToken() ?? '',
        user: me.user,
      });
      return true;
    } catch {
      clearAuthSession();
      setUser(null);
      return false;
    }
  }, [refreshIfNeeded]);

  useEffect(() => {
    void validateSession().finally(() => setLoading(false));
  }, [validateSession]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await authJson<{
      accessToken: string;
      refreshToken: string;
      user: StoredUser;
    }>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    saveAuthSession(data);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => { /* ignore */ });
    }
    clearAuthSession();
    setUser(null);
  }, []);

  const hasPermission = useCallback((permission: string) => {
    return user?.permissions.includes(permission) ?? false;
  }, [user]);

  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    login,
    logout,
    refreshIfNeeded,
    hasPermission,
  }), [user, loading, login, logout, refreshIfNeeded, hasPermission]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response = await fetch(input, { ...init, headers });
  if (response.status !== 401) return response;

  const refreshToken = getRefreshToken();
  if (refreshToken) {
    const refreshed = await authJson<{
      accessToken: string;
      refreshToken: string;
      user: StoredUser;
    }>('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);

    if (refreshed) {
      saveAuthSession(refreshed);
      headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
      response = await fetch(input, { ...init, headers });
      if (response.status !== 401) return response;
    }
  }

  notifyAuthExpired();
  return response;
}
