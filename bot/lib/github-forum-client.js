/**
 * GitHub App client for the Forum ↔ Issues integration.
 *
 * GitHub App authentication, not a personal access token: an installation is
 * restricted to the repositories the administrator selected, and the tokens it
 * issues are short-lived (one hour) and scoped by GitHub itself. Three
 * credentials are environment-only and are never stored in the database, never
 * returned to the browser and never logged:
 *
 *   - `GITHUB_APP_ID`             the App's numeric id
 *   - `GITHUB_APP_PRIVATE_KEY`    the App's PEM private key (RS256)
 *   - `GITHUB_APP_INSTALLATION_ID` the installation to act as
 *
 * `GITHUB_WEBHOOK_SECRET` is the fourth: it verifies inbound webhook deliveries
 * and is read only by the receiver.
 *
 * Only native `node:crypto` and `fetch` are used, so nothing is added to the
 * bot's small dependency set. The installation token is cached in-process until
 * shortly before it expires, because minting one on every call would be slow and
 * would count against the App's rate limit.
 *
 * ## Test seam
 *
 * `githubFetch` defers to `globalThis.__testFetcher` when a test has installed
 * one, so every request shape — the JWT, the token exchange, the API calls, the
 * 429 handling — is exercised without a real App key or a network call. The real
 * path always uses `fetch`.
 */
import crypto from 'node:crypto';
import { parseRepositoryFullName, isRetryableStatus, retryAfterMs, redactSecret } from './github-forum-logic.js';

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'projecthub-forum-sync';

/** Minted installation tokens are reused for this long, minus a safety margin. */
const TOKEN_SAFETY_MS = 5 * 60 * 1000;

let cachedToken = { token: '', expiresAt: 0, installationId: null };

/** The App credentials, read lazily so tests can set the environment. */
export function getGithubAppConfig(env = process.env) {
  const privateKey = normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  return {
    appId: String(env.GITHUB_APP_ID || '').trim(),
    privateKey,
    installationId: String(env.GITHUB_APP_INSTALLATION_ID || '').trim(),
    webhookSecret: String(env.GITHUB_WEBHOOK_SECRET || '').trim(),
  };
}

/**
 * Rebuilds a PEM key from an environment variable.
 *
 * Hosts store a multi-line secret as a single line with literal `\n`, so those
 * are turned back into real newlines before the key is parsed. A key that is
 * already multi-line is left untouched.
 */
export function normalizePrivateKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.includes('\\n')) return value.replace(/\\n/g, '\n').trim();
  return value;
}

/** Whether the App is configured enough to act. Never reports the key value. */
export function isGithubAppConfigured(env = process.env) {
  const config = getGithubAppConfig(env);
  return Boolean(config.appId && config.privateKey && config.installationId);
}

/** Whether the webhook secret is present. Never reports its value. */
export function isWebhookConfigured(env = process.env) {
  return Boolean(String(env.GITHUB_WEBHOOK_SECRET || '').trim());
}

/** A base64url segment of a JWT. */
function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Signs a GitHub App JWT (RS256).
 *
 * GitHub requires `iat` slightly in the past to tolerate clock skew and an `exp`
 * no more than 10 minutes out. The key is used only here, in memory, and is
 * never serialized into a log line or a response.
 */
export function signAppJwt({ appId, privateKey, now = Date.now(), ttlSeconds = 540 } = {}) {
  if (!appId) throw new Error('GITHUB_APP_ID is not set');
  if (!privateKey) throw new Error('GITHUB_APP_PRIVATE_KEY is not set');

  const issuedAt = Math.floor(now / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + ttlSeconds, iss: String(appId) }));
  const signingInput = `${header}.${payload}`;

  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(privateKey, 'base64url');
  return `${signingInput}.${signature}`;
}

/** The fetch used for GitHub calls, overridable in tests. */
function githubFetch(...args) {
  if (typeof globalThis.__testFetcher === 'function') return globalThis.__testFetcher(...args);
  return fetch(...args);
}

/** Standard GitHub API headers. The token is added by the caller. */
function baseHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': USER_AGENT,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Exchanges the App JWT for an installation access token.
 *
 * The token is cached until just before it expires. A response that does not
 * carry a token is an error: a missing token must not silently degrade into an
 * unauthenticated call.
 */
export async function getInstallationToken({ env = process.env, now = Date.now(), force = false } = {}) {
  const { appId, privateKey, installationId } = getGithubAppConfig(env);
  if (!appId || !privateKey || !installationId) {
    throw new Error('The GitHub App is not configured (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID)');
  }
  if (!force && cachedToken.token && cachedToken.installationId === installationId && now < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const jwt = signAppJwt({ appId, privateKey, now });
  const response = await githubFetch(`${API_BASE}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: baseHeaders(jwt),
  });

  if (!response.ok) {
    const detail = await safeJson(response);
    throw new GithubApiError(`Could not mint an installation token (${response.status})`, {
      status: response.status,
      detail: detail?.message || null,
    });
  }

  const body = await response.json();
  if (!body?.token) {
    throw new GithubApiError('GitHub returned no installation token', { status: response.status });
  }

  const expiresAt = body.expires_at ? new Date(body.expires_at).getTime() - TOKEN_SAFETY_MS : now + 30 * 60 * 1000;
  cachedToken = { token: body.token, expiresAt, installationId };
  return body.token;
}

/** Clears the cached installation token. Used by tests and on a 401. */
export function clearTokenCache() {
  cachedToken = { token: '', expiresAt: 0, installationId: null };
}

/** A GitHub API failure carrying the status and the safe message. */
export class GithubApiError extends Error {
  constructor(message, { status = null, detail = null } = {}) {
    super(message);
    this.name = 'GithubApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** Parses a JSON body, tolerating an empty or non-JSON one. */
async function safeJson(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * One authenticated GitHub API call, with a bounded retry on transient statuses.
 *
 * A 401 clears the cached installation token once and retries, because an
 * installation token can be revoked or rotate out from under a long-running
 * process. 429/5xx/403 are retried with GitHub's own `Retry-After` when it is
 * present, else a short fixed backoff; the caller's queue owns the longer
 * schedule, so this stays a small in-request retry.
 */
export async function githubRequest(
  path,
  { method = 'GET', body = null, env = process.env, now = Date.now(), retries = 2, fetchImpl = null } = {},
) {
  const call = fetchImpl || githubFetch;
  let token = await getInstallationToken({ env, now });
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    attempt += 1;
    const options = { method, headers: baseHeaders(token) };
    if (body !== null && body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await call(`${API_BASE}${path}`, options);
    } catch (error) {
      lastError = new GithubApiError(redactSecret(error.message, token), { status: null });
      await sleep(nextDelay(attempt));
      continue;
    }

    if (response.ok) {
      if (response.status === 204) return null;
      return safeJson(response);
    }

    if (response.status === 401 && attempt <= retries) {
      clearTokenCache();
      token = await getInstallationToken({ env, now, force: true });
      continue;
    }

    const payload = await safeJson(response);
    lastError = new GithubApiError(`GitHub API ${method} ${path} failed (${response.status})`, {
      status: response.status,
      detail: payload?.message || null,
    });

    if (!isRetryableStatus(response.status) || attempt > retries) {
      throw lastError;
    }

    const hinted = retryAfterMs(response.headers, payload);
    await sleep(hinted ?? nextDelay(attempt));
  }

  throw lastError || new GithubApiError(`GitHub API ${method} ${path} failed`);
}

function nextDelay(attempt) {
  return Math.min(8000, 500 * 2 ** (attempt - 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------- operations */

/** Creates an issue. Returns the shaped issue or throws. */
export async function createIssue({ owner, repository, title, body, labels = [], env = process.env, fetchImpl = null } = {}) {
  const payload = { title, body };
  if (labels.length) payload.labels = labels;
  const issue = await githubRequest(`/repos/${owner}/${repository}/issues`, {
    method: 'POST',
    body: payload,
    env,
    fetchImpl,
  });
  return shapeIssue(issue);
}

/** Adds a comment to an issue. */
export async function createIssueComment({ owner, repository, issueNumber, body, env = process.env, fetchImpl = null } = {}) {
  const comment = await githubRequest(`/repos/${owner}/${repository}/issues/${issueNumber}/comments`, {
    method: 'POST',
    body: { body },
    env,
    fetchImpl,
  });
  return shapeComment(comment);
}

/** Reads an issue (used to refresh state and to validate a link). */
export async function getIssue({ owner, repository, issueNumber, env = process.env, fetchImpl = null } = {}) {
  const issue = await githubRequest(`/repos/${owner}/${repository}/issues/${issueNumber}`, { env, fetchImpl });
  return shapeIssue(issue);
}

/** Reads one comment. */
export async function getIssueComment({ owner, repository, commentId, env = process.env, fetchImpl = null } = {}) {
  const comment = await githubRequest(`/repos/${owner}/${repository}/issues/comments/${commentId}`, { env, fetchImpl });
  return shapeComment(comment);
}

/**
 * Validates that the installation can see a repository.
 *
 * Used by the dashboard's "Validate access" action, so an operator learns that
 * the App is not installed on a repository *before* a Forum post fails. Returns
 * a discriminated result rather than throwing, so the UI can show an actionable
 * message.
 */
export async function checkRepositoryAccess({ owner, repository, env = process.env, fetchImpl = null } = {}) {
  if (!isGithubAppConfigured(env)) {
    return {
      ok: false,
      reason: 'app_not_configured',
      message: 'The GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID.',
    };
  }
  try {
    const repo = await githubRequest(`/repos/${owner}/${repository}`, { env, fetchImpl });
    if (!repo?.full_name) {
      return { ok: false, reason: 'not_found', message: `${owner}/${repository} was not found.` };
    }
    const permissions = repo.permissions || {};
    return {
      ok: true,
      reason: 'ok',
      fullName: repo.full_name,
      private: Boolean(repo.private),
      defaultBranch: repo.default_branch || null,
      // Reported so the UI can warn when the App was granted more than needed.
      canPush: Boolean(permissions.push),
      htmlUrl: repo.html_url || `https://github.com/${owner}/${repository}`,
      message: `The installation can see ${repo.full_name}.`,
    };
  } catch (error) {
    if (error?.status === 404) {
      return {
        ok: false,
        reason: 'not_installed',
        message:
          `The GitHub App is not installed on ${owner}/${repository}, or the repository does not exist. ` +
          'Install the App on this repository and try again.',
      };
    }
    if (error?.status === 403) {
      return {
        ok: false,
        reason: 'forbidden',
        message: `The installation lacks permission for ${owner}/${repository}. Grant Issues: read and write, and Metadata: read.`,
      };
    }
    return { ok: false, reason: 'error', message: error?.message || 'The repository could not be validated.' };
  }
}

/* --------------------------------------------------------------- shaping */

export function shapeIssue(raw) {
  if (!raw) return null;
  return {
    number: raw.number,
    id: raw.id,
    title: raw.title || '',
    state: raw.state || 'open',
    url: raw.html_url || '',
    nodeId: raw.node_id || null,
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null,
    closedAt: raw.closed_at || null,
    user: raw.user ? { login: raw.user.login, id: raw.user.id } : null,
  };
}

export function shapeComment(raw) {
  if (!raw) return null;
  return {
    id: raw.id,
    body: raw.body || '',
    url: raw.html_url || '',
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null,
    user: raw.user ? { login: raw.user.login, id: raw.user.id, type: raw.user.type || null } : null,
  };
}

/* ------------------------------------------------------- webhook verification */

/**
 * Verifies a GitHub webhook signature.
 *
 * GitHub signs the raw request body with HMAC-SHA256 and the shared webhook
 * secret, and sends the digest as `X-Hub-Signature-256: sha256=<hex>`. The
 * comparison is constant-time and the secret is required: a missing secret
 * refuses the delivery outright rather than accepting anything.
 *
 * `rawBody` must be the exact bytes GitHub sent, before any JSON parsing — a
 * re-serialized body will not match.
 */
export function verifyWebhookSignature(rawBody, signatureHeader, secret, { algorithm = 'sha256' } = {}) {
  if (!secret) return { ok: false, reason: 'no_secret' };
  const provided = String(signatureHeader || '').trim();
  if (!provided) return { ok: false, reason: 'missing_signature' };

  const [scheme, digest] = provided.split('=');
  if (scheme !== algorithm || !digest) return { ok: false, reason: 'bad_scheme' };

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected = crypto.createHmac(algorithm, secret).update(body).digest('hex');

  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true, reason: 'ok' };
}

/** The signature header GitHub sends for a SHA-256 digest. */
export const SIGNATURE_HEADER = 'x-hub-signature-256';
