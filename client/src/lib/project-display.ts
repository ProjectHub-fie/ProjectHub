/**
 * Presentation helpers for verified projects.
 *
 * Deliberately free of React and DOM imports (like the other `client/src/lib`
 * validation modules) so the Node test runner can load it directly and pin the
 * rules that decide which layout a project gets and how app metadata is shown.
 */

export type ProjectCategory = "websites" | "bots" | "utilities";

/** The subset of a project these helpers read. Kept structural on purpose. */
export interface ProjectDisplayInput {
  category: string;
  liveUrl?: string | null;
  githubUrl?: string | null;
  appVersion?: string | null;
  appSize?: string | null;
  platforms?: string[] | null;
  requirements?: string[] | null;
  releaseNotes?: string | null;
  screenshots?: string[] | null;
  technologies?: string[] | null;
}

/**
 * A utility is rendered as an installable application only when it actually
 * carries app metadata. A plain "utility" with no download, size or platform
 * information would otherwise get an application page with nothing in it, so it
 * falls back to the ordinary project layout.
 */
export function hasAppMetadata(project: ProjectDisplayInput | null | undefined): boolean {
  if (!project) return false;
  return Boolean(
    project.appVersion ||
      project.appSize ||
      (project.platforms && project.platforms.length > 0) ||
      (project.requirements && project.requirements.length > 0) ||
      project.releaseNotes ||
      (project.screenshots && project.screenshots.length > 0),
  );
}

/** True when the project should use the application-style detail layout. */
export function isInstallableApp(project: ProjectDisplayInput | null | undefined): boolean {
  if (!project) return false;
  return project.category === "utilities" && hasAppMetadata(project);
}

/** Non-empty string arrays only, so an empty array never renders a heading. */
export function nonEmpty(values: string[] | null | undefined): string[] {
  return Array.isArray(values) ? values.filter((v) => typeof v === "string" && v.trim() !== "") : [];
}

/**
 * Splits a version string into comparable numeric parts.
 * `1.10.0` -> [1, 10, 0]; a trailing `-beta`/`+build` is ignored.
 */
export function parseVersion(version: string | null | undefined): number[] {
  if (!version || typeof version !== "string") return [];
  const core = version.trim().replace(/^v/i, "").split(/[-+]/)[0];
  return core
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * Orders two version strings the way a release feed does, so `1.10.0` sorts
 * above `1.9.0` (a plain string compare would not). Missing parts count as 0.
 */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * A GitHub Releases download URL for an APK asset.
 *
 * The "latest" alias resolves to the newest non-prerelease release and needs no
 * API call, which keeps the detail page a plain link instead of a fetch that
 * would hit the unauthenticated rate limit.
 */
export function githubLatestReleaseUrl(githubUrl: string | null | undefined): string | null {
  const base = repoUrl(githubUrl);
  return base ? `${base}/releases/latest` : null;
}

/**
 * Label for the primary install action, derived from the target platform so a
 * Windows or desktop build does not read "Download for Android".
 */
export function installLabel(project: ProjectDisplayInput | null | undefined): string {
  const platforms = nonEmpty(project?.platforms).join(" ").toLowerCase();
  if (/windows|win32/.test(platforms)) return "Download for Windows";
  if (/macos|mac os|darwin/.test(platforms)) return "Download for macOS";
  if (/linux|ubuntu|debian|fedora|arch|centos|rhel/.test(platforms)) return "Download for Linux";
  if (/android/.test(platforms)) return "Download for Android";
  if (/ios|iphone|ipad/.test(platforms)) return "Download for iOS";
  return "Download";
}

/** Normalises a GitHub repo URL to `https://github.com/owner/repo`, or null. */
export function repoUrl(githubUrl: string | null | undefined): string | null {
  if (!githubUrl || typeof githubUrl !== "string") return null;
  const match = githubUrl.trim().match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2].replace(/\.git$/, "")}`;
}

/** True when the project exposes any outbound link the footer should render. */
export function hasAnyLink(project: ProjectDisplayInput | null | undefined): boolean {
  if (!project) return false;
  return Boolean(project.liveUrl || project.githubUrl);
}
