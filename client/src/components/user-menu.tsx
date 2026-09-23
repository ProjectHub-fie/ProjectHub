import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { LayoutDashboard, LogIn, LogOut, Moon, Sun } from "lucide-react";
import { useAuth, type AuthStatus, type AuthUser } from "@/hooks/useAuth";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { displayName, userAvatarUrl, userInitials } from "@/lib/user-display";

/** Anonymous placeholder used until a visitor signs in. */
function ProfilePlaceholder() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-6 w-6"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}

/**
 * The trigger glyph.
 *
 * While the initial `/api/auth/me` call is in flight the state is genuinely
 * unknown, so a quiet skeleton is shown instead of the anonymous person glyph —
 * showing that glyph and then swapping it out a moment later is the visual half
 * of the "still looks logged out when signed in" bug.
 */
function ProfileTrigger({ status, user }: { status: AuthStatus; user: AuthUser | null }) {
  if (status === "loading") {
    return (
      <span
        className="h-6 w-6 animate-pulse rounded-full bg-muted"
        aria-hidden="true"
        data-testid="profile-trigger-loading"
      />
    );
  }

  if (status === "authenticated" && user) {
    const avatarUrl = userAvatarUrl(user);
    return (
      <Avatar className="h-8 w-8">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback className="bg-primary/10 text-xs text-primary">
          {userInitials(user)}
        </AvatarFallback>
      </Avatar>
    );
  }

  return <ProfilePlaceholder />;
}

/** Avatar, name and email for the signed-in panel header. */
function ProfileSummary({ user }: { user: AuthUser }) {
  const avatarUrl = userAvatarUrl(user);
  return (
    <div className="flex items-center gap-3 px-3 py-2" data-testid="profile-menu-user">
      <Avatar className="h-10 w-10">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback className="bg-primary/10 text-sm text-primary">
          {userInitials(user)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" data-testid="profile-menu-name">
          {displayName(user)}
        </p>
        {user.email ? (
          <p className="truncate text-xs text-muted-foreground" data-testid="profile-menu-email">
            {user.email}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Placeholder shown in the panel while auth resolves.
 *
 * It matches the height of the real summary so the panel does not jump when the
 * user arrives.
 */
function ProfileSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2" data-testid="profile-menu-loading">
      <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <span className="block h-3.5 w-24 animate-pulse rounded bg-muted" />
        <span className="block h-3 w-32 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

function ThemeRow() {
  const { theme, setTheme } = useTheme();
  const [, forceRender] = useState(0);

  // The sidebar toggles the same theme through the shared provider; re-render
  // on its broadcast so this icon never shows a stale state.
  useEffect(() => {
    const onChange = () => forceRender((n) => n + 1);
    window.addEventListener("projecthub:theme-change", onChange);
    return () => window.removeEventListener("projecthub:theme-change", onChange);
  }, []);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      data-testid="profile-menu-theme"
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-yellow-500" />
      ) : (
        <Moon className="h-4 w-4 text-primary" />
      )}
      <span>Theme colour</span>
      <span className="ml-auto text-xs text-muted-foreground">{isDark ? "Dark" : "Light"}</span>
    </button>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      data-testid={testId}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * Profile control that replaces the client-site navigation bar.
 *
 * Anonymous visitors see a person glyph and are offered sign-in plus the theme
 * control; a signed-in visitor sees their avatar instead and gets dashboard and
 * logout entries. The panel slides in from the right and out again on close.
 *
 * Every branch below is driven by `status` from the shared auth provider. There
 * is deliberately no local "am I signed in" flag: one of those used to be seeded
 * to `false` and stayed that way, so the panel kept offering Log in to a user
 * the server had already authenticated.
 */
export function UserMenu() {
  const [, setLocation] = useLocation();
  const { user, status, isAuthenticated, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Trigger the slide-in on the frame after open so the transition has a
  // starting value to animate from.
  useEffect(() => {
    if (isOpen) {
      const frame = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setIsVisible(false);
  }, [isOpen]);

  // Close on an outside click or Escape.
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const go = (path: string) => {
    setIsOpen(false);
    setLocation(path);
  };

  const handleLogout = () => {
    // Close the panel first so it never shows a signed-out user in the
    // signed-in layout while the request is in flight.
    setIsOpen(false);
    void logout();
    setLocation("/");
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={isAuthenticated ? "Account menu" : "Sign in menu"}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary/60 text-foreground transition-colors hover:bg-secondary"
        data-testid="profile-menu-trigger"
      >
        <ProfileTrigger status={status} user={user} />
      </button>

      {isOpen && (
        <div
          role="menu"
          className={`absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg transition-all duration-200 ease-out ${
            isVisible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
          }`}
          data-testid="profile-menu"
        >
          {status === "loading" ? (
            <ProfileSkeleton />
          ) : isAuthenticated && user ? (
            <>
              <ProfileSummary user={user} />
              <div className="my-1 h-px bg-border" />
              <MenuItem
                icon={<LayoutDashboard className="h-4 w-4" />}
                label="Dashboard"
                onClick={() => go("/dashboard")}
                testId="profile-menu-dashboard"
              />
              <MenuItem
                icon={<LogOut className="h-4 w-4" />}
                label="Log out"
                onClick={handleLogout}
                testId="profile-menu-logout"
              />
            </>
          ) : (
            <MenuItem
              icon={<LogIn className="h-4 w-4" />}
              label="Log in"
              onClick={() => go("/login")}
              testId="profile-menu-login"
            />
          )}
          <div className="my-1 h-px bg-border" />
          <ThemeRow />
        </div>
      )}
    </div>
  );
}
