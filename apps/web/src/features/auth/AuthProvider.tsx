/**
 * Session state.
 *
 * The access token lives in memory inside `lib/api.ts`; this provider holds the current
 * user and the permissions the server calculated. The UI asks `can(...)` to decide what to
 * show — but hiding a button is a courtesy, not a control. Every one of these permissions
 * is enforced again on the server.
 */
import type { CurrentUser, Permission } from '@ekavist/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  login as apiLogin,
  logout as apiLogout,
  restoreSession,
  setUnauthenticatedHandler,
} from '../../lib/api.js';

interface AuthState {
  user: CurrentUser | null;
  /** True until the initial "am I signed in?" check has finished. */
  initialising: boolean;
  /** `code` is the authenticator or recovery code, once two-factor is on. */
  signIn: (email: string, password: string, code?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: (user: CurrentUser) => void;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [initialising, setInitialising] = useState(true);

  // On load, try the refresh cookie. A returning user lands straight on their dashboard.
  useEffect(() => {
    let cancelled = false;
    void restoreSession().then((session) => {
      if (cancelled) return;
      if (session != null) setUser(session.user);
      setInitialising(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // When a request finally fails to authenticate, drop back to the login screen rather
  // than leaving a half-working page behind.
  useEffect(() => {
    setUnauthenticatedHandler(() => setUser(null));
  }, []);

  const signIn = useCallback(async (email: string, password: string, code?: string) => {
    const session = await apiLogin(email, password, code);
    setUser(session.user);
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      initialising,
      signIn,
      signOut,
      refreshUser: setUser,
      can: (permission) => permissions.has(permission),
    }),
    [user, initialising, signIn, signOut, permissions],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (context == null) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}

/** The signed-in user, for the many places that only run when someone is signed in. */
export function useCurrentUser(): CurrentUser {
  const { user } = useAuth();
  if (user == null) throw new Error('useCurrentUser was called while signed out.');
  return user;
}
