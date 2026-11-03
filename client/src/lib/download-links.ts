/**
 * Installer link rules, shared by the admin form and the detail page.
 *
 * Two things make this a security-relevant module rather than a formatting
 * helper. A download link is the one field an administrator can set that makes
 * a visitor's browser leave the site and pull down an executable, so it is
 * restricted to HTTPS on a known file-hosting domain. And a MEGA share link
 * carries its decryption key in the URL fragment, which means the link *is* the
 * credential: it must never be echoed into an error message, a log line or a
 * thrown Error, because those outlive the request and are read by people who
 * were never given the key.
 *
 * Deliberately free of React, DOM and `@/` imports so the Node test runner can
 * load it directly, the same way `email-validation.ts` is loaded. The server
 * mirror lives in `api/_lib/download-links.js`; `tests/download-links.test.mjs`
 * asserts the two agree on the trusted hosts and the accept/reject decisions.
 */

/** Hosts a download link may point at. Exact matches only — see `isTrustedMegaHost`. */
export const MEGA_DOWNLOAD_HOSTS = [
  "mega.nz",
  "www.mega.nz",
  "mega.io",
  "www.mega.io",
  "mega.co.nz",
  "www.mega.co.nz",
] as const;

export type DownloadPlatform = "android" | "windows";

export type DownloadLinkResult = { valid: true; url: string } | { valid: false; reason: string };

/** Per-platform facts shown in the download dialog. All optional. */
export interface PlatformDownloadDetail {
  packageName?: string | null;
  version?: string | null;
  size?: string | null;
  releaseDate?: string | null;
  sha256?: string | null;
  /** Older builds of the same platform, newest first. */
  previousVersions?: PreviousVersion[] | null;
}

/**
 * One superseded build of a platform.
 *
 * The URL is required — a version entry with no link cannot be downloaded, so it
 * is not a version entry. It is a MEGA share link, which means it carries its own
 * decryption key and is a credential in exactly the way the current link is: it
 * is validated on the server and never interpolated into a message or a log.
 */
export interface PreviousVersion {
  version: string;
  url: string;
  packageName?: string | null;
  size?: string | null;
  releaseDate?: string | null;
  sha256?: string | null;
}

/** Upper bound on stored previous versions per platform, so the blob stays bounded. */
export const MAX_PREVIOUS_VERSIONS = 20;

export type DownloadDetails = Partial<Record<DownloadPlatform, PlatformDownloadDetail>>;

/** The subset of a project the download helpers read. Structural on purpose. */
export interface DownloadProjectInput {
  liveUrl?: string | null;
  githubUrl?: string | null;
  githubReleasesFallback?: boolean | null;
  androidDownloadUrl?: string | null;
  windowsDownloadUrl?: string | null;
  downloadDetails?: DownloadDetails | null;
}

/** A resolved, renderable download option. */
export interface DownloadCard {
  platform: DownloadPlatform;
  label: string;
  url: string;
  packageName: string | null;
  version: string | null;
  size: string | null;
  releaseDate: string | null;
  sha256: string | null;
}

const PLATFORM_LABELS: Record<DownloadPlatform, string> = {
  android: "Android",
  windows: "Windows",
};

// A MEGA share id is a base64url-ish token; the key is the same alphabet plus
// padding. Anchored, so a lookalike path cannot ride along.
const MEGA_ID = "[A-Za-z0-9_-]{6,}";
const MEGA_FILE_PATH = new RegExp(`^/(file|folder|embed)/${MEGA_ID}/?$`);
const MEGA_LEGACY_HASH = new RegExp(`^#!${MEGA_ID}!${MEGA_ID}$`);

/**
 * True only for an exact trusted host.
 *
 * A suffix test would accept `mega.nz.attacker.example`, and a `startsWith`
 * test would accept `mega.nz-attacker.example`, so neither is used: the parsed
 * hostname must equal an entry in the list.
 */
export function isTrustedMegaHost(host: string | null | undefined): boolean {
  if (!host || typeof host !== "string") return false;
  return (MEGA_DOWNLOAD_HOSTS as readonly string[]).includes(host.toLowerCase());
}

/**
 * Validates a download link, returning the reason it was refused.
 *
 * `null`, `undefined` and `""` mean "not provided" and are not an error — that
 * is how the dashboard clears a link. Anything else must be an HTTPS MEGA share
 * link, complete with its decryption key: a `/file/` link with no fragment
 * cannot be decrypted by anyone who follows it, so it is reported as incomplete
 * rather than stored and discovered broken later.
 *
 * No branch ever puts the input into the returned string. That is the whole
 * point: the fragment is the key.
 */
export function validateMegaDownloadUrl(value: unknown): DownloadLinkResult {
  if (value === null || value === undefined) return { valid: true, url: "" };
  if (typeof value !== "string") return { valid: false, reason: "Download link must be text" };

  const trimmed = value.trim();
  if (!trimmed) return { valid: true, url: "" };

  let parsed: URL;
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

  // The fragment is the decryption key. A share link without one is unusable,
  // and silently storing it produces a download button that cannot work.
  if (parsed.hash.length <= 1) {
    return { valid: false, reason: "This link is missing its MEGA decryption key (the part after #)" };
  }

  // Returned trimmed rather than re-serialised: `URL` would rebuild the string
  // and the key must survive byte-for-byte.
  return { valid: true, url: trimmed };
}

/** Message for a refused link, or null when it is acceptable or absent. */
export function downloadUrlProblem(value: unknown): string | null {
  const result = validateMegaDownloadUrl(value);
  return result.valid ? null : result.reason;
}

/** Message for a malformed SHA-256, or null when absent or well-formed. */
export function sha256Problem(value: unknown): string | null {
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
 * empty strings dropped so the UI's "when available" checks stay honest.
 *
 * An unrecognised platform key is discarded rather than stored: the shape is
 * written by the dashboard and read by the detail page, and anything else is
 * either a typo or a payload that was never meant to round-trip.
 *
 * A previous version is kept only when it has both a version label and a valid
 * MEGA link. That is the same rule the server enforces, and it is what stops a
 * half-filled row (a version with no file, or a file with no version to name it)
 * from reaching the detail page and rendering as a dead download.
 */
export function normalizeDownloadDetails(value: unknown): DownloadDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  const result: DownloadDetails = {};

  for (const platform of ["android", "windows"] as const) {
    const entry = source[platform];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const raw = entry as Record<string, unknown>;
    const detail: PlatformDownloadDetail = {};

    for (const field of ["packageName", "version", "size", "releaseDate"] as const) {
      const fieldValue = raw[field];
      if (typeof fieldValue !== "string") continue;
      const trimmed = fieldValue.trim();
      if (trimmed) detail[field] = trimmed;
    }

    const checksum = raw.sha256;
    if (typeof checksum === "string" && !sha256Problem(checksum)) {
      detail.sha256 = checksum.trim().toLowerCase();
    }

    const previous = normalizePreviousVersions(raw.previousVersions);
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
 * Order is preserved (the form and the page both treat index 0 as newest), and
 * the cap keeps a runaway paste from bloating the row.
 */
export function normalizePreviousVersions(value: unknown): PreviousVersion[] {
  if (!Array.isArray(value)) return [];

  const result: PreviousVersion[] = [];

  for (const entry of value) {
    if (result.length >= MAX_PREVIOUS_VERSIONS) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const raw = entry as Record<string, unknown>;
    const version = typeof raw.version === "string" ? raw.version.trim() : "";
    if (!version) continue;

    const link = validateMegaDownloadUrl(raw.url);
    if (!link.valid || !link.url) continue;

    const item: PreviousVersion = { version, url: link.url };

    for (const field of ["packageName", "size", "releaseDate"] as const) {
      const fieldValue = raw[field];
      if (typeof fieldValue !== "string") continue;
      const trimmed = fieldValue.trim();
      if (trimmed) item[field] = trimmed;
    }

    const checksum = raw.sha256;
    if (typeof checksum === "string" && !sha256Problem(checksum)) {
      item.sha256 = checksum.trim().toLowerCase();
    }

    result.push(item);
  }

  return result;
}

/** The stored link for one platform, or null when it is unset or unusable. */
export function platformDownloadUrl(
  project: DownloadProjectInput | null | undefined,
  platform: DownloadPlatform,
): string | null {
  const raw = platform === "android" ? project?.androidDownloadUrl : project?.windowsDownloadUrl;
  const result = validateMegaDownloadUrl(raw);
  return result.valid && result.url ? result.url : null;
}

export function hasPlatformDownload(
  project: DownloadProjectInput | null | undefined,
  platform: DownloadPlatform,
): boolean {
  return platformDownloadUrl(project, platform) !== null;
}

/** Per-platform facts for one platform, or null when nothing was configured. */
export function platformDetail(
  project: DownloadProjectInput | null | undefined,
  platform: DownloadPlatform,
): PlatformDownloadDetail | null {
  const details = normalizeDownloadDetails(project?.downloadDetails);
  return details[platform] || null;
}

/**
 * The usable previous versions for one platform, newest first.
 *
 * Reads through the same normaliser the server uses, so a hand-edited row or an
 * older stored blob cannot put an entry on the page that the current rules would
 * have rejected — an unusable link is dropped here too.
 */
export function previousVersionsFor(
  project: DownloadProjectInput | null | undefined,
  platform: DownloadPlatform,
): PreviousVersion[] {
  const detail = platformDetail(project, platform);
  return normalizePreviousVersions(detail?.previousVersions);
}

/**
 * The current build plus every superseded one, newest first.
 *
 * A previous version is only offered for a platform that has a current link: the
 * archive of an app that is no longer distributed is not a download the page
 * should advertise, and this keeps the "is this project installable" answer the
 * same as before.
 */
export function allPlatformVersions(
  project: DownloadProjectInput | null | undefined,
  platform: DownloadPlatform,
): PreviousVersion[] {
  const current = platformDownloadUrl(project, platform);
  if (!current) return [];
  const detail = platformDetail(project, platform) || {};
  return [
    {
      version: detail.version || "Current",
      url: current,
      packageName: detail.packageName ?? null,
      size: detail.size ?? null,
      releaseDate: detail.releaseDate ?? null,
      sha256: detail.sha256 ?? null,
    },
    ...previousVersionsFor(project, platform),
  ];
}

/**
 * The platforms that actually have a link, in display order.
 *
 * This is the single source of truth for "show this download button": both the
 * header actions and the platform cards are built from it, so a button can
 * never appear for a platform with no URL. Android is first because the app
 * ships for it first.
 */
export function downloadCards(project: DownloadProjectInput | null | undefined): DownloadCard[] {
  const cards: DownloadCard[] = [];

  for (const platform of ["android", "windows"] as const) {
    const url = platformDownloadUrl(project, platform);
    if (!url) continue;

    const detail = platformDetail(project, platform) || {};
    cards.push({
      platform,
      label: `Download for ${PLATFORM_LABELS[platform]}`,
      url,
      packageName: detail.packageName ?? null,
      version: detail.version ?? null,
      size: detail.size ?? null,
      releaseDate: detail.releaseDate ?? null,
      sha256: detail.sha256 ?? null,
    });
  }

  return cards;
}

/**
 * A GitHub Releases link, but only when the dashboard turned it on.
 *
 * It used to be an implicit fallback whenever a utility had a repo, which meant
 * an app with no installer at all still offered a download button pointing at a
 * release page. Requiring the flag makes the fallback a decision someone made.
 */
export function githubReleasesFallbackUrl(
  project: DownloadProjectInput | null | undefined,
): string | null {
  if (!project?.githubReleasesFallback) return null;
  const githubUrl = project.githubUrl;
  if (!githubUrl || typeof githubUrl !== "string") return null;
  const match = githubUrl.trim().match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2].replace(/\.git$/, "")}/releases/latest`;
}

/**
 * The best installer URL for a utility, or null when it has none.
 *
 * `liveUrl` is deliberately not consulted. A website's own address is not an
 * installer, and treating it as one is what made the app page offer "Download"
 * for a project that was really just a web app.
 */
export function primaryInstallUrl(project: DownloadProjectInput | null | undefined): string | null {
  const cards = downloadCards(project);
  if (cards.length > 0) return cards[0].url;
  return githubReleasesFallbackUrl(project);
}

/** Label matching `primaryInstallUrl`, so the two cannot disagree. */
export function primaryInstallLabel(project: DownloadProjectInput | null | undefined): string {
  const cards = downloadCards(project);
  if (cards.length > 0) return cards[0].label;
  return githubReleasesFallbackUrl(project) ? "Download from GitHub Releases" : "Download";
}

/**
 * A log-safe form of a download link: origin and path only.
 *
 * The fragment is the decryption key, so it is dropped. This exists so that any
 * future diagnostic line has an obviously correct option to reach for instead
 * of interpolating the raw URL.
 */
export function redactDownloadUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "(none)";
  try {
    const parsed = new URL(value.trim());
    const path = parsed.pathname.replace(/\/[A-Za-z0-9_-]{6,}\/?$/, "/…");
    return `${parsed.origin}${path}`;
  } catch {
    return "(unparseable)";
  }
}
