import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl?: string | null;
}

/**
 * Explicit authentication states.
 *
 * The old hook derived its flag from the mere presence of a user object, so the
 * very first render — before `/api/auth/me` had answered — reported "logged
 * out". The profile menu latched onto that and kept showing the anonymous glyph
 * and the Log in button even after the user resolved. A three-state machine
 * removes the ambiguity: `loading` is not `unauthenticated`.
 */
export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

const USER_STORAGE_KEY = "projecthub_user";
export const SESSION_TOKEN_KEY = "projecthub_session_token";

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    localStorage.removeItem(USER_STORAGE_KEY);
    return null;
  }
}

function storeUser(user: AuthUser | null) {
  if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_STORAGE_KEY);
}

/** Builds the headers a session-bearing request needs. */
function sessionHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (token) headers["X-User-Session"] = token;
  return headers;
}

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: { email: string; password: string; captchaToken?: string }) => Promise<any>;
  register: (userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    captchaToken?: string;
  }) => Promise<any>;
  logout: () => Promise<any>;
  updateProfile: (userData: {
    firstName?: string;
    lastName?: string;
    profileImageUrl?: string;
  }) => Promise<any>;
  refreshAuth: () => Promise<AuthUser | null>;
  isLoggingIn: boolean;
  isRegistering: boolean;
  isLoggingOut: boolean;
  isUpdatingProfile: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * The single source of truth for who is signed in.
 *
 * Mounted once, above the router, so the header menu, the sidebar, the
 * dashboard and every protected page read the same state instead of each
 * `useAuth()` call owning its own copy — which is what let the avatar say
 * "signed out" while the dashboard was happy to render.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // Seeded from localStorage purely so a reload does not flash the anonymous
  // glyph; the server response below is what actually decides the state.
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());
  const [status, setStatus] = useState<AuthStatus>("loading");

  // Guards against a late `/me` response from a previous mount overwriting a
  // logout that happened in between.
  const generation = useRef(0);

  const applyUser = useCallback((next: AuthUser | null) => {
    setUser(next);
    storeUser(next);
    setStatus(next ? "authenticated" : "unauthenticated");
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    applyUser(null);
  }, [applyUser]);

  /**
   * Resolves the current user from the server.
   *
   * This is the only thing that can promote the state to `authenticated`. The
   * cookie the Discord callback sets and the `X-User-Session` header a password
   * login stores are both accepted by `/api/auth/me`, so both flows converge
   * here.
   */
  const refreshAuth = useCallback(async (): Promise<AuthUser | null> => {
    const mine = ++generation.current;
    setStatus("loading");

    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
        headers: sessionHeaders(),
      });

      if (mine !== generation.current) return null;

      if (response.ok) {
        const data = await response.json();
        if (data?.user) {
          applyUser(data.user);
          return data.user;
        }
      }

      // 401 is the normal "not signed in" answer; anything else means we could
      // not ask, so keep the seeded user rather than signing them out on a blip.
      if (response.status === 401) {
        clearSession();
      } else {
        setStatus(user ? "authenticated" : "unauthenticated");
      }
      return null;
    } catch {
      // Network failure: fall back to whatever we already had.
      setStatus(user ? "authenticated" : "unauthenticated");
      return null;
    }
  }, [applyUser, clearSession, user]);

  useEffect(() => {
    // The initial "who am I" check. Runs once on mount.
    void refreshAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loginMutation = useMutation({
    mutationFn: async (credentials: { email: string; password: string; captchaToken?: string }) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(credentials),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Invalid email or password");
      }
      return data;
    },
    onSuccess: (data) => {
      if (data?.sessionToken) {
        localStorage.setItem(SESSION_TOKEN_KEY, data.sessionToken);
      }
      applyUser(data.user);
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: () => {
      clearSession();
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (userData: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      captchaToken?: string;
    }) => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(userData),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Registration failed");
      }
      return data;
    },
    onSuccess: (data) => {
      // The register endpoint signs a session token exactly like /login, but
      // it used to be dropped here. The user was then "signed in" from
      // localStorage alone and dropped back to anonymous on the next reload,
      // because /api/auth/me needs this token to identify them.
      if (data?.sessionToken) {
        localStorage.setItem(SESSION_TOKEN_KEY, data.sessionToken);
      }
      if (data?.user) {
        applyUser(data.user);
      }
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
    onError: () => {
      localStorage.removeItem(SESSION_TOKEN_KEY);
      clearSession();
    },
  });

  // Defined before the mutation so the callbacks can share one teardown path.
  const finishLogout = useCallback(() => {
    // Bumping the generation discards any in-flight `/me` that started before
    // the logout, so cached user data cannot reappear.
    generation.current += 1;
    clearSession();
    queryClient.clear();
  }, [clearSession, queryClient]);

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: sessionHeaders(),
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Logout failed");
      }
      return response.json().catch(() => ({}));
    },
    onSuccess: finishLogout,
    // Even if the server call fails, the local session must go: leaving the UI
    // signed in after "Log out" is worse than a stale server cookie.
    onError: finishLogout,
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (userData: {
      firstName?: string;
      lastName?: string;
      profileImageUrl?: string;
    }) => {
      const response = await fetch("/api/auth/user", {
        method: "PATCH",
        headers: sessionHeaders(),
        credentials: "include",
        body: JSON.stringify(userData),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to update profile");
      }
      return data;
    },
    onSuccess: (data) => {
      if (data?.user) {
        applyUser(data.user);
        queryClient.invalidateQueries({ queryKey: ["auth"] });
      }
    },
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      isLoading: status === "loading",
      isAuthenticated: status === "authenticated" && Boolean(user),
      login: loginMutation.mutateAsync,
      register: registerMutation.mutateAsync,
      logout: logoutMutation.mutateAsync,
      updateProfile: updateProfileMutation.mutateAsync,
      refreshAuth,
      isLoggingIn: loginMutation.isPending,
      isRegistering: registerMutation.isPending,
      isLoggingOut: logoutMutation.isPending,
      isUpdatingProfile: updateProfileMutation.isPending,
    }),
    [user, status, refreshAuth, loginMutation, registerMutation, logoutMutation, updateProfileMutation],
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return context;
}
