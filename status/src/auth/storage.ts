const ACCESS_KEY = 'kc_access_token';
const REFRESH_KEY = 'kc_refresh_token';
const USER_KEY = 'kc_user';

export interface StoredUser {
  id: string;
  username: string;
  role: string;
  roleLabel: string;
  permissions: string[];
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function getStoredUser(): StoredUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function saveAuthSession(input: {
  accessToken: string;
  refreshToken: string;
  user: StoredUser;
}): void {
  localStorage.setItem(ACCESS_KEY, input.accessToken);
  localStorage.setItem(REFRESH_KEY, input.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(input.user));
}

export function clearAuthSession(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getAuthToken(): string | null {
  return getAccessToken();
}
