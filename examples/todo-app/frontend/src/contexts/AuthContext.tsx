// src/contexts/AuthContext.tsx
// Story: S-AUTH-04 (frontend)
// Maps to REQ: REQ-002, REQ-003
//
// AuthProvider exposes {user, login, logout, loading}. On mount it
// restores the session from localStorage and, when the stored JWT has
// expired, attempts a silent refresh via POST /api/v1/auth/refresh.
// If the refresh fails the stale data is cleared and the user stays
// unauthenticated.

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  refreshSession,
  logoutUser,
  type User,
} from '../api/auth';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'auth_user';
const TOKEN_STORAGE_KEY = 'auth_access_token';

interface StoredAuth {
  user: User;
  accessToken: string;
}

interface AuthContextValue {
  user: User | null;
  login: (user: User, accessToken: string) => void;
  logout: () => void;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function readStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw || !token) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    if (parsed.user && typeof parsed.user.id === 'string') {
      return { user: parsed.user, accessToken: token };
    }
    return null;
  } catch {
    return null;
  }
}

function clearStoredAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function writeStoredAuth(user: User, accessToken: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, accessToken }));
  localStorage.setItem(TOKEN_STORAGE_KEY, accessToken);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount. If a stored JWT exists we trust it when
  // it is still valid; when expired we attempt a silent refresh. If
  // the refresh fails we clear the stale data.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const stored = readStoredAuth();
      if (!stored) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Quick check — is the stored JWT still valid?
      let expired = false;
      try {
        const payload = JSON.parse(atob(stored.accessToken.split('.')[1]));
        if (typeof payload.exp === 'number' && payload.exp * 1000 > Date.now()) {
          // Still valid — restore without network call.
          if (!cancelled) {
            setUser(stored.user);
            setLoading(false);
          }
          return;
        }
        expired = true;
      } catch {
        expired = true;
      }

      if (!expired) {
        if (!cancelled) {
          setUser(stored.user);
          setLoading(false);
        }
        return;
      }

      // JWT expired — attempt silent refresh.
      const ok = await refreshSession();
      if (cancelled) return;

      if (ok) {
        setUser(stored.user);
      } else {
        clearStoredAuth();
      }
      setLoading(false);
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Persist user + JWT after a successful login (or register).
   * The caller already holds the parsed response from the API.
   */
  const login = useCallback((newUser: User, accessToken: string) => {
    setUser(newUser);
    writeStoredAuth(newUser, accessToken);
  }, []);

  /**
   * Clear auth state, call the logout endpoint, and redirect to /login.
   */
  const logout = useCallback(async () => {
    setUser(null);
    clearStoredAuth();
    await logoutUser();
    window.location.assign('/login');
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
