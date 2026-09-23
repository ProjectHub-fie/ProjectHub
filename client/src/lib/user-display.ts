import type { AuthUser } from "@/hooks/useAuth";

/**
 * Display name and initials for an authenticated user.
 *
 * Discord accounts arrive with `firstName` set to the Discord display name and
 * an empty `lastName`, so a naive `first + last` lookup produces a blank initial
 * for them. Falling back to the email local-part keeps every account rendering
 * something meaningful.
 */
export function displayName(user: AuthUser | null): string {
  if (!user) return "";
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (user.email) return user.email.split("@")[0];
  return "ProjectHub user";
}

export function userInitials(user: AuthUser | null): string {
  if (!user) return "";
  const first = user.firstName?.trim()[0] ?? "";
  const last = user.lastName?.trim()[0] ?? "";
  const initials = `${first}${last}`.toUpperCase();
  if (initials) return initials;
  if (user.email) return user.email.trim()[0]?.toUpperCase() ?? "";
  return "?";
}

/**
 * The avatar to render for an authenticated user, or null when there is none.
 *
 * Only a value the server already validated and stored reaches this point, so
 * an arbitrary user-supplied URL is never trusted here.
 */
export function userAvatarUrl(user: AuthUser | null): string | null {
  const url = user?.profileImageUrl?.trim();
  return url ? url : null;
}
