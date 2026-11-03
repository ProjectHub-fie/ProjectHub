/**
 * Server-side mirror of `client/src/lib/download-links.ts`.
 *
 * The dashboard validates as the administrator types, but the browser is
 * trivially bypassed, so this is the check that actually holds: `POST`/`PUT
 * /api/admin/verified-projects` refuse a link that fails here.
 *
 * The client module cannot be imported from `api/` — it lives under `client/`,
 * which is not part of the serverless bundle, and a `.ts` file has no place in
 * a function's dependency graph. The two files therefore hold the same rules
 * written twice, and `tests/download-links.test.mjs` drives both with the same
 * table of links so they cannot drift.
 *
 * A MEGA share link carries its decryption key in the URL fragment, so the link
 * is itself a credential. Nothing in this module ever interpolates the value it
 * was given into a returned message or a log line.
 */

/** Hosts a download link may point at. Exact matches only. */
export const MEGA_DOWNLOAD_HOSTS = [
  "mega.nz",
  "www.mega.nz",
  "mega.io",
  "www.mega.io",
  "mega.co.nz",
  "www.mega.co.nz",
];

export const DOWNLOAD_PLATFORMS = ["android", "windows"];

/** Upper bound on stored previous versions per platform, so the blob stays bounded. */
export const MAX_PREVIOUS_VERSIONS = 20;

const MEGA_ID = "[A-Za-z0-9_-]{6,}";
const MEGA_FILE_PATH = new RegExp(`^/(file|folder|embed)/${MEGA_ID}/?$`);
const MEGA_LEGACY_HASH = new RegExp(`^#!${MEGA_ID}!${MEGA_ID}$`);

/** True only for an exact trusted host, so a lookalike domain cannot pass. */
export function isTrustedMegaHost(host) {
  if (!host || typeof host !== "string") return false;
  return MEGA_DOWNLOAD_HOSTS.includes(host.toLowerCase());
}

/**
 * Validates a download link. Returns `{ valid: true, url }` or
 * `{ valid: false, reason }`.
 *
 * `null`, `undefined` and `""` mean "not provided" and are accepted as empty —
 * that is how the dashboard clears a link. Anything else must be an HTTPS MEGA
 * share link complete with its decryption key.
 */
export function validateMegaDownloadUrl(value) {
  if (value === null || value === undefined) return { valid: true, url: "" };
  if (typeof value !== "string") return { valid: false, reason: "Download link must be text" };

  const trimmed = value.trim();
  if (!trimmed) return { valid: true, url: "" };

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: "Enter a complete link, including https://" };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "Download links must use HTTPS" };
  }

  if (!isTrustedMegaHost(parsed.hostname)) {
    return { valid: false, reason: "Download links must be hosted on MEGA (mega.nz or mega.io)" };
  }

  const isLegacy = MEGA_LEGACY_HASH.test(parsed.hash);
  const isModern = MEGA_FILE_PATH.test(parsed.pathname);

  if (!isModern && !isLegacy) {
    return {
      valid: false,
      reason: "Use a MEGA file or folder share link, e.g. https://mega.nz/file/<id>#<key>",
    };
  }

  if (parsed.hash.length <= 1) {
    return { valid: false, reason: "This link is missing its MEGA decryption key (the part after #)" };
  }

  return { valid: true, url: trimmed };
}

/** Message for a refused link, or null when it is acceptable or absent. */
export function downloadUrlProblem(value) {
  const result = validateMegaDownloadUrl(value);
  return result.valid ? null : result.reason;
}

/** Message for a malformed SHA-256, or null when absent or well-formed. */
export function sha256Problem(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "Checksum must be text";
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[a-f0-9]{64}$/i.test(trimmed)) {
    return "A SHA-256 checksum is 64 hexadecimal characters";
  }
  return null;
}

/**
 * Keeps only the fields and platforms this module understands, trimmed, with
 * empty strings dropped. An unrecognised platform key is discarded rather than
 * stored, so a payload cannot widen the shape the detail page reads.
 *
 * A previous version survives only with both a version label and a valid MEGA
 * link, which is what stops a half-filled row from rendering as a dead download.
 */
export function normalizeDownloadDetails(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result = {};

  for (const platform of DOWNLOAD_PLATFORMS) {
    const entry = value[platform];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const detail = {};

    for (const field of ["packageName", "version", "size", "releaseDate"]) {
      const fieldValue = entry[field];
      if (typeof fieldValue !== "string") continue;
      const trimmed = fieldValue.trim();
      if (trimmed) detail[field] = trimmed;
    }

    const checksum = entry.sha256;
    if (typeof checksum === "string" && !sha256Problem(checksum)) {
      detail.sha256 = checksum.trim().toLowerCase();
    }

    const previous = normalizePreviousVersions(entry.previousVersions);
    if (previous.length > 0) detail.previousVersions = previous;

    if (Object.keys(detail).length > 0) result[platform] = detail;
  }

  return result;
}

/**
 * Keeps the previous-version entries that are complete, in order, capped.
 *
 * A URL that fails validation drops the whole entry rather than being stored
 * empty: the entry exists to be downloaded, so an unusable link makes it noise.
 * The same rule is written in `client/src/lib/download-links.ts`, and
 * `tests/download-links.test.mjs` drives both with one table so they cannot
 * drift. No branch puts the input URL into a returned value.
 */
export function normalizePreviousVersions(value) {
  if (!Array.isArray(value)) return [];

  const result = [];

  for (const entry of value) {
    if (result.length >= MAX_PREVIOUS_VERSIONS) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const version = typeof entry.version === "string" ? entry.version.trim() : "";
    if (!version) continue;

    const link = validateMegaDownloadUrl(entry.url);
    if (!link.valid || !link.url) continue;

    const item = { version, url: link.url };

    for (const field of ["packageName", "size", "releaseDate"]) {
      const fieldValue = entry[field];
      if (typeof fieldValue !== "string") continue;
      const trimmed = fieldValue.trim();
      if (trimmed) item[field] = trimmed;
    }

    const checksum = entry.sha256;
    if (typeof checksum === "string" && !sha256Problem(checksum)) {
      item.sha256 = checksum.trim().toLowerCase();
    }

    result.push(item);
  }

  return result;
}

/**
 * Validates the download fields of a project payload.
 *
 * Returns `{ problem }` naming the first refused field, or `{ androidDownloadUrl,
 * windowsDownloadUrl, downloadDetails }` with the accepted values. A rejected
 * link is an error rather than a silent drop: storing the previous value while
 * reporting success is how a broken installer link survives unnoticed.
 */
export function validateDownloadFields(data) {
  if (!data || typeof data !== "object") return {};

  const problem = downloadUrlProblem(data.androidDownloadUrl);
  if (problem) return { problem: `Android download link: ${problem}` };

  const windowsProblem = downloadUrlProblem(data.windowsDownloadUrl);
  if (windowsProblem) return { problem: `Windows download link: ${windowsProblem}` };

  // A previous version's link is checked with the same rule as the current one,
  // and a bad one is reported rather than dropped. Silently discarding the row
  // would leave the administrator believing the old build was saved.
  const previousProblem = previousVersionProblem(data.downloadDetails);
  if (previousProblem) return { problem: previousProblem };

  const result = {};

  if (Object.prototype.hasOwnProperty.call(data, "androidDownloadUrl")) {
    result.androidDownloadUrl = validateMegaDownloadUrl(data.androidDownloadUrl).url || null;
  }
  if (Object.prototype.hasOwnProperty.call(data, "windowsDownloadUrl")) {
    result.windowsDownloadUrl = validateMegaDownloadUrl(data.windowsDownloadUrl).url || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, "downloadDetails")) {
    const details = normalizeDownloadDetails(data.downloadDetails);
    result.downloadDetails = Object.keys(details).length > 0 ? details : null;
  }

  return result;
}

/**
 * The first refused previous-version link, or null when all are acceptable.
 *
 * Only the link is refused here; a row with no version label is dropped by the
 * normaliser, because that is an incomplete row rather than an unsafe one. The
 * message names the platform and the position so the administrator can find the
 * row, and never includes the URL — it carries a decryption key.
 */
export function previousVersionProblem(downloadDetails) {
  if (!downloadDetails || typeof downloadDetails !== "object") return null;

  for (const platform of DOWNLOAD_PLATFORMS) {
    const entry = downloadDetails[platform];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const previous = entry.previousVersions;
    if (!Array.isArray(previous)) continue;

    for (let index = 0; index < previous.length; index += 1) {
      const row = previous[index];
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;

      // An entirely blank row is what the form adds before anything is typed,
      // so it is not an error.
      const label = typeof row.version === "string" ? row.version.trim() : "";
      const rawUrl = typeof row.url === "string" ? row.url.trim() : "";
      if (!label && !rawUrl) continue;

      const reason = downloadUrlProblem(row.url);
      if (reason) {
        const name = platform === "windows" ? "Windows" : "Android";
        return `${name} previous version ${index + 1}: ${reason}`;
      }
    }
  }

  return null;
}

/**
 * A log-safe form of a download link: origin and path only, with the share id
 * elided. The fragment is the decryption key and is never included. This exists
 * so a diagnostic line has an obviously correct option to reach for.
 */
export function redactDownloadUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "(none)";
  try {
    const parsed = new URL(value.trim());
    const path = parsed.pathname.replace(/\/[A-Za-z0-9_-]{6,}\/?$/, "/…");
    return `${parsed.origin}${path}`;
  } catch {
    return "(unparseable)";
  }
}
