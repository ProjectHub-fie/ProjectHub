import crypto from 'node:crypto';

/**
 * The public API's session token, shared by the serverless function
 * (api/index.js) and the Express server so local development and production
 * authenticate identically.
 *
 * A token is an HMAC-signed payload, not a raw base64 blob: the old format was
 * `base64(JSON)` that anyone could mint for an arbitrary user id, so signing it
 * makes the identity unforgeable without `SESSION_SECRET`. The expiry lives
 * inside the signed payload, so it cannot be extended by editing the token.
 */

/** How long a signed session token stays valid (default 30 days). */
export const SESSION_TTL_MS = Number(process.env.SESSION_TTL_DAYS || 30) * 24 * 60 * 60 * 1000;

function hmac(value) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET must be set');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

/** Signs a session token for a user row. */
export function signSessionToken(user) {
  const issuedAt = Date.now();
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_MS,
  })).toString('base64url');

  return `${payload}.${hmac(payload)}`;
}

/**
 * Returns the token payload, or null when the token is missing, tampered with
 * or expired.
 */
export function readSessionToken(token) {
  if (!token || typeof token !== 'string') return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = hmac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
    // A signature proves we issued the payload, not that it is still current.
    if (typeof parsed?.exp !== 'number' || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The user shape sent to the client.
 *
 * Centralised so every auth response (me, login, register, profile update,
 * Discord) exposes exactly the same fields — the client's auth state depends on
 * a stable shape, and `profileImageUrl` in particular must always be present so
 * the avatar never flickers back to the logged-out glyph.
 */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    profileImageUrl: user.profileImageUrl ?? null,
  };
}

/* -------------------------------------------------------------------------
   Cookie transport

   The token also travels in an HttpOnly cookie. That is what makes a
   top-level OAuth redirect work at all: Discord sends the browser straight to
   `/api/auth/discord/callback`, and a token returned only in a URL fragment
   belongs to that document. By the time `/login` or `/dashboard` loads it is a
   different document and the fragment is gone — which is how a successful
   Discord handshake ended with no session. A cookie set on the callback
   response is carried into every subsequent request instead.
------------------------------------------------------------------------- */

/** Versioned visitor cookie name. */
export const VISITOR_COOKIE = 'projecthub_session';

/** Life of the visitor cookie, matching the signed token's own expiry. */
export const VISITOR_COOKIE_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);

/** Parses a `Cookie:` header into a plain object. */
export function parseCookies(header = '') {
  const cookies = {};
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      cookies[name] = part.slice(separator + 1).trim();
    }
  }
  return cookies;
}

/**
 * `SameSite=Lax` is deliberate: Discord's callback is a top-level GET
 * navigation, so `Lax` is sufficient and safer than `None`, and the flow never
 * relies on a cross-site POST. `Secure` is added whenever the public origin is
 * https, which covers Vercel production.
 */
function cookieAttributes(maxAgeSeconds) {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (Number.isFinite(maxAgeSeconds)) attributes.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
  if (process.env.APP_ORIGIN?.startsWith('https') || process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }
  return attributes;
}

/** The `Set-Cookie` value that stores a session token. */
export function sessionCookie(token, maxAgeSeconds = VISITOR_COOKIE_MAX_AGE) {
  return `${VISITOR_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(maxAgeSeconds).join('; ')}`;
}

/** The `Set-Cookie` value that removes the session cookie. */
export function clearedSessionCookie() {
  return sessionCookie('', 0);
}

/**
 * The session token for a request, from either transport.
 *
 * The `X-User-Session` header wins so the SPA's explicit token is never
 * shadowed by a stale cookie left over from another account.
 */
export function sessionTokenFrom(headers = {}) {
  const headerToken = headers['x-user-session'];
  if (headerToken) return headerToken;
  return parseCookies(headers.cookie)[VISITOR_COOKIE] || null;
}
