import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Download,
  Github,
  Star,
  ShieldCheck,
  Share2,
  Cpu,
  HardDrive,
  Tag,
  MonitorSmartphone,
  ListChecks,
  Images,
  ScrollText,
  Smartphone,
  Monitor,
  Calendar,
  Hash,
  History,
  ChevronDown,
  Package as PackageIcon,
} from "lucide-react";
import { useLocation } from "wouter";
import { ProjectInteractions } from "@/components/project-interactions";
import {
  nonEmpty,
  repoUrl,
  type ProjectCategory,
} from "@/lib/project-display";
import {
  downloadCards,
  githubReleasesFallbackUrl,
  previousVersionsFor,
  type DownloadCard,
  type DownloadPlatform,
  type PreviousVersion,
} from "@/lib/download-links";

/**
 * Application-store style detail page for installable utilities.
 *
 * The web/bot layout leads with prose and a single action button; an app page
 * leads with identity (icon, name, developer), then install facts, then a
 * screenshot gallery, then "what's new" and the requirements list — the order a
 * store listing uses. Rendered only when `isInstallableApp()` is true, so
 * utilities without app metadata keep the ordinary layout.
 *
 * Downloads are per platform. Each button exists only because a link is set for
 * that platform, so a missing Windows build cannot render an Android button's
 * label, and there is never a disabled "Download" that goes nowhere. The
 * project's `liveUrl` is deliberately not used as an installer: a website's own
 * address is not a package, and offering it as one is what this page used to do.
 */
export interface AppDetailProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  longDescription?: string | null;
  imageUrl?: string | null;
  category: ProjectCategory | string;
  technologies?: string[] | null;
  features?: string[] | null;
  highlights?: string[] | null;
  liveUrl?: string | null;
  githubUrl?: string | null;
  status?: string | null;
  authorName?: string | null;
  authorAvatar?: string | null;
  architecture?: string | null;
  timeline?: string | null;
  teamSize?: string | null;
  userCount?: string | null;
  appVersion?: string | null;
  appSize?: string | null;
  platforms?: string[] | null;
  requirements?: string[] | null;
  releaseNotes?: string | null;
  screenshots?: string[] | null;
  androidDownloadUrl?: string | null;
  windowsDownloadUrl?: string | null;
  downloadDetails?: Record<string, Record<string, unknown>> | null;
  githubReleasesFallback?: boolean | null;
}

interface AppDetailProps {
  project: AppDetailProject;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-500",
  developing: "bg-amber-500",
  live: "bg-blue-500",
  beta: "bg-yellow-500",
  archived: "bg-gray-500",
};

function statusStyle(status: string | null | undefined): string {
  return STATUS_STYLES[String(status || "").toLowerCase()] || "bg-gray-500";
}

function statusLabel(status: string | null | undefined): string {
  const value = String(status || "unknown");
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** A store-style fact cell: icon, label, value. */
function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 min-w-0">
      <div className="mt-0.5 text-muted-foreground shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="font-medium truncate" title={value}>{value}</div>
      </div>
    </div>
  );
}

/** One label/value row inside the download dialog. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-border/50 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right break-all">{value}</span>
    </div>
  );
}

/**
 * What the confirmation dialog is about to open.
 *
 * A current installer and an archived one both reduce to this, so one dialog
 * serves both and the confirmation, the "opens on MEGA" wording and the checksum
 * block cannot diverge between the two paths.
 */
type PendingDownload = {
  platform: DownloadPlatform;
  label: string;
  url: string;
  packageName: string | null;
  version: string | null;
  size: string | null;
  releaseDate: string | null;
  sha256: string | null;
  /** True for an archived build, which the dialog labels as such. */
  archived: boolean;
};

/**
 * The superseded builds of one platform, collapsed by default.
 *
 * Collapsed because the current installer is what almost every visitor wants;
 * the archive is for the case the current build broke something. It renders
 * nothing at all when there are none, so a project without an archive looks
 * exactly as it did before this existed.
 *
 * The list is `<details>` rather than a controlled dialog: it is a disclosure,
 * not a modal, and the browser gives keyboard access and the open/closed state
 * for free. The link itself is never rendered — it carries the MEGA decryption
 * key — so a row is a button that opens the same confirmation dialog the current
 * installer uses.
 */
function PreviousVersions({
  platform,
  versions,
  onSelect,
}: {
  platform: DownloadPlatform;
  versions: PreviousVersion[];
  onSelect: (entry: PreviousVersion) => void;
}) {
  if (versions.length === 0) return null;

  return (
    <details
      className="mt-4 border-t pt-3 group"
      data-testid={`previous-versions-${platform}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        <History className="w-3.5 h-3.5" />
        Previous versions ({versions.length})
        <ChevronDown className="w-3.5 h-3.5 ml-auto transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-3 space-y-1.5">
        {versions.map((entry, index) => (
          <li key={`${entry.version}-${index}`}>
            <button
              type="button"
              onClick={() => onSelect(entry)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-left text-xs hover:border-primary/40 hover:bg-secondary/40 transition-colors"
              data-testid={`button-previous-version-${platform}-${index}`}
            >
              <span className="min-w-0">
                <span className="block font-medium truncate">v{entry.version}</span>
                <span className="block text-[11px] text-muted-foreground truncate">
                  {[entry.releaseDate, entry.size, entry.packageName].filter(Boolean).join(" · ") ||
                    "Archived build"}
                </span>
              </span>
              <Download className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Older builds are kept for compatibility. The current release is recommended.
      </p>
    </details>
  );
}

function PlatformIcon({ platform, className }: { platform: DownloadPlatform; className?: string }) {
  return platform === "windows" ? (
    <Monitor className={className} />
  ) : (
    <Smartphone className={className} />
  );
}

export default function AppDetail({ project }: AppDetailProps) {
  const [, setLocation] = useLocation();
  // What the confirmation dialog is about to open. A current installer and an
  // archived one are the same shape to the dialog: a platform, a MEGA link and
  // the facts to show above the button.
  const [pending, setPending] = useState<PendingDownload | null>(null);

  const screenshots = nonEmpty(project.screenshots);
  const platforms = nonEmpty(project.platforms);
  const requirements = nonEmpty(project.requirements);
  const features = nonEmpty(project.features);
  const highlights = nonEmpty(project.highlights);
  const technologies = nonEmpty(project.technologies);

  const cards = downloadCards(project);
  const releasesUrl = githubReleasesFallbackUrl(project);
  const sourceUrl = repoUrl(project.githubUrl);

  // A per-platform card carries its own facts; the strip falls back to the
  // project-wide value so a project that only set the top-level fields still
  // shows something useful.
  const primaryCard = cards[0] || null;
  const version = project.appVersion || primaryCard?.version || null;
  const size = project.appSize || primaryCard?.size || null;
  const releaseDate = primaryCard?.releaseDate || null;
  const checksums = cards.filter((card) => card.sha256);

  const openDownload = (card: DownloadCard) => {
    setPending({ ...card, archived: false });
  };

  /**
   * Opens the dialog for an archived build of a platform.
   *
   * The platform and the label come from the card the archive belongs to, so the
   * dialog names the same platform the button sat under.
   */
  const openArchivedDownload = (card: DownloadCard, entry: PreviousVersion) => {
    setPending({
      platform: card.platform,
      label: `Download for ${card.platform === "windows" ? "Windows" : "Android"}`,
      url: entry.url,
      packageName: entry.packageName ?? null,
      version: entry.version,
      size: entry.size ?? null,
      releaseDate: entry.releaseDate ?? null,
      sha256: entry.sha256 ?? null,
      archived: true,
    });
  };

  const confirmDownload = () => {
    if (!pending) return;
    // `noopener` because the target is a third-party origin: without it the
    // opened page can reach back through `window.opener`.
    window.open(pending.url, "_blank", "noopener,noreferrer");
    setPending(null);
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <Button
          variant="ghost"
          onClick={() => setLocation("/projects")}
          className="mb-8 hover-elevate"
          data-testid="button-back-to-projects"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Button>

        {/* Store header: icon, name, developer, install facts, primary actions */}
        <div className="flex flex-col md:flex-row md:items-start gap-6 md:gap-8 mb-10">
          <div className="shrink-0">
            <img
              src={project.imageUrl || "/api/placeholder/400/300"}
              alt={`${project.title} icon`}
              className="w-28 h-28 md:w-36 md:h-36 rounded-3xl object-cover border shadow-lg bg-muted"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/api/placeholder/400/300";
              }}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{project.title}</h1>
              <Badge className={`${statusStyle(project.status)} text-white px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border-0 shadow-sm`}>
                {statusLabel(project.status)}
              </Badge>
            </div>

            {project.authorName && (
              <p className="text-primary font-medium mb-2" data-testid="text-app-developer">
                {project.authorName}
              </p>
            )}

            <p className="text-muted-foreground leading-relaxed mb-4">
              {project.description}
            </p>

            {platforms.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6" data-testid="list-app-platforms">
                {platforms.map((platform) => (
                  <Badge key={platform} variant="secondary" className="px-3 py-1 text-xs font-medium">
                    <MonitorSmartphone className="w-3 h-3 mr-1" />
                    {platform}
                  </Badge>
                ))}
              </div>
            )}

            {/* One button per configured platform, plus the source link. A
                platform with no link contributes no button at all. */}
            <div className="flex flex-col sm:flex-row flex-wrap gap-3">
              {cards.map((card) => (
                <Button
                  key={card.platform}
                  size="lg"
                  className="sm:w-auto"
                  onClick={() => openDownload(card)}
                  data-testid={`button-download-${card.platform}`}
                >
                  <Download className="w-4 h-4 mr-2" />
                  {card.label}
                </Button>
              ))}

              {cards.length === 0 && releasesUrl && (
                <Button
                  size="lg"
                  className="sm:w-auto"
                  onClick={() => window.open(releasesUrl, "_blank", "noopener,noreferrer")}
                  data-testid="button-download-github-releases"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download from GitHub Releases
                </Button>
              )}

              {sourceUrl && (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => window.open(sourceUrl, "_blank", "noopener,noreferrer")}
                  data-testid="button-app-source"
                >
                  <Github className="w-4 h-4 mr-2" />
                  Source Code
                </Button>
              )}
            </div>

            {cards.length === 0 && !releasesUrl && (
              <p className="text-xs text-muted-foreground mt-3" data-testid="text-no-download">
                No installer is published for this app yet.
              </p>
            )}
          </div>
        </div>

        {/* Install facts strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6 rounded-2xl border bg-card mb-10" data-testid="app-facts">
          {version && (
            <Fact icon={<Tag className="w-4 h-4" />} label="Version" value={version} />
          )}
          {size && (
            <Fact icon={<HardDrive className="w-4 h-4" />} label="Package size" value={size} />
          )}
          <Fact
            icon={<Cpu className="w-4 h-4" />}
            label="Supported OS"
            value={platforms.length > 0 ? platforms.join(", ") : "Not specified"}
          />
          {releaseDate ? (
            <Fact icon={<Calendar className="w-4 h-4" />} label="Release date" value={releaseDate} />
          ) : (
            <Fact
              icon={<Calendar className="w-4 h-4" />}
              label="Updated"
              value={project.timeline || "Ongoing"}
            />
          )}
        </div>

        {/* Per-platform download cards. Rendered from the same list as the
            header buttons, so the two can never disagree about availability. */}
        {cards.length > 0 && (
          <section className="mb-12" data-testid="app-download-cards">
            <h2 className="text-2xl font-bold mb-4">Downloads</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {cards.map((card) => (
                <div
                  key={card.platform}
                  className="flex flex-col p-6 rounded-2xl border bg-card hover:border-primary/40 transition-colors"
                  data-testid={`card-download-${card.platform}`}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <PlatformIcon platform={card.platform} className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold">{card.platform === "windows" ? "Windows" : "Android"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {card.packageName || "Installer package"}
                      </div>
                    </div>
                  </div>

                  <dl className="space-y-2 text-sm mb-5">
                    {card.version && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Version</dt>
                        <dd className="font-medium">{card.version}</dd>
                      </div>
                    )}
                    {card.size && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Size</dt>
                        <dd className="font-medium">{card.size}</dd>
                      </div>
                    )}
                    {card.releaseDate && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">Released</dt>
                        <dd className="font-medium">{card.releaseDate}</dd>
                      </div>
                    )}
                  </dl>

                  <Button
                    className="mt-auto w-full"
                    onClick={() => openDownload(card)}
                    data-testid={`button-card-download-${card.platform}`}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    {card.label}
                  </Button>

                  <PreviousVersions
                    platform={card.platform}
                    versions={previousVersionsFor(project, card.platform)}
                    onSelect={(entry) => openArchivedDownload(card, entry)}
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Installers are hosted on MEGA. The download opens in a new tab.
            </p>
          </section>
        )}

        {/* Screenshot gallery */}
        {screenshots.length > 0 && (
          <section className="mb-12" data-testid="app-screenshots">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Images className="w-5 h-5 text-muted-foreground" />
              Screenshots
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1">
              {screenshots.map((shot, i) => (
                <img
                  key={`${shot}-${i}`}
                  src={shot}
                  alt={`${project.title} screenshot ${i + 1}`}
                  loading="lazy"
                  className="h-72 w-auto rounded-2xl border object-cover shadow-md bg-muted shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "/api/placeholder/400/300";
                  }}
                />
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          <div className="lg:col-span-2 space-y-10">
            {project.longDescription && (
              <section>
                <h2 className="text-2xl font-bold mb-4">About this app</h2>
                <p className="text-foreground leading-relaxed whitespace-pre-line">
                  {project.longDescription}
                </p>
              </section>
            )}

            {features.length > 0 && (
              <section data-testid="app-features">
                <h2 className="text-2xl font-bold mb-4">What you can do</h2>
                <ul className="space-y-3">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <ListChecks className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{feature}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {project.releaseNotes && (
              <section data-testid="app-release-notes">
                <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                  <ScrollText className="w-5 h-5 text-muted-foreground" />
                  What's new
                </h2>
                <div className="p-6 rounded-2xl border bg-secondary/20">
                  <p className="leading-relaxed whitespace-pre-line text-foreground">
                    {project.releaseNotes}
                  </p>
                </div>
              </section>
            )}

            {technologies.length > 0 && (
              <section>
                <h2 className="text-2xl font-bold mb-4">Built with</h2>
                <div className="flex flex-wrap gap-2">
                  {technologies.map((tech) => (
                    <Badge key={tech} variant="outline" className="px-4 py-2 text-sm font-medium">
                      {tech}
                    </Badge>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="space-y-8">
            {highlights.length > 0 && (
              <section className="p-6 rounded-2xl border bg-card" data-testid="app-highlights">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Star className="w-4 h-4 text-yellow-500" />
                  Highlights
                </h3>
                <ul className="space-y-3">
                  {highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <ShieldCheck className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {requirements.length > 0 && (
              <section className="p-6 rounded-2xl border bg-card" data-testid="app-requirements">
                <h3 className="text-lg font-bold mb-4">Requirements</h3>
                <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                  {requirements.map((req) => (
                    <li key={req} className="leading-relaxed">{req}</li>
                  ))}
                </ul>
              </section>
            )}

            {checksums.length > 0 && (
              <section className="p-6 rounded-2xl border bg-card" data-testid="app-checksums">
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <Hash className="w-4 h-4 text-muted-foreground" />
                  Checksums
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Verify a download before running it.
                </p>
                {checksums.map((card) => (
                  <div key={card.platform} className="mb-3 last:mb-0">
                    <div className="text-xs font-semibold mb-1">
                      {card.platform === "windows" ? "Windows" : "Android"} · SHA-256
                    </div>
                    <code className="block text-[11px] leading-relaxed break-all font-mono text-muted-foreground bg-secondary/40 rounded-lg p-2">
                      {card.sha256}
                    </code>
                  </div>
                ))}
              </section>
            )}

            {project.architecture && (
              <section className="p-6 rounded-2xl border bg-secondary/20">
                <h3 className="text-lg font-bold mb-3">Architecture</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{project.architecture}</p>
              </section>
            )}

            {project.userCount && (
              <section className="p-6 rounded-2xl border bg-card">
                <h3 className="text-lg font-bold mb-1">Users</h3>
                <p className="text-sm text-muted-foreground">{project.userCount}</p>
              </section>
            )}
          </aside>
        </div>

        {/* Footer actions + interactions */}
        <div className="flex flex-col sm:flex-row flex-wrap gap-4 mt-12 pt-8 border-t border-border/50">
          {cards.map((card) => (
            <Button
              key={card.platform}
              className="flex-1 min-w-[12rem]"
              onClick={() => openDownload(card)}
              data-testid={`button-footer-download-${card.platform}`}
            >
              <Download className="w-4 h-4 mr-2" />
              {card.label}
            </Button>
          ))}
          {sourceUrl && (
            <Button variant="outline" onClick={() => window.open(sourceUrl, "_blank", "noopener,noreferrer")}>
              <Github className="w-4 h-4 mr-2" />
              View Source Code
            </Button>
          )}
          <Button
            variant="outline"
            onClick={async () => {
              const shareData = { title: project.title, text: project.description, url: window.location.href };
              try {
                if (navigator.share) await navigator.share(shareData);
                else await navigator.clipboard.writeText(window.location.href);
              } catch {
                /* user dismissed the share sheet */
              }
            }}
            data-testid="button-app-share"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
        </div>

        <div className="mt-8 pt-8 border-t border-border/50">
          <ProjectInteractions projectId={project.id} size="lg" />
        </div>
      </div>

      {/* Download details / confirmation. The link itself is never rendered:
          it carries the MEGA decryption key, and putting it on screen would
          leak the credential to anyone looking over a shoulder or over a
          screen share. Only the package facts are shown. */}
      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }}>
        <DialogContent className="max-w-md" data-testid="app-download-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pending && <PlatformIcon platform={pending.platform} className="w-5 h-5 text-primary" />}
              {pending ? `Download for ${pending.platform === "windows" ? "Windows" : "Android"}` : "Download"}
            </DialogTitle>
            <DialogDescription>
              {pending?.archived
                ? `You are about to download an older build of ${project.title} from MEGA. The file opens in a new tab.`
                : `You are about to download ${project.title} from MEGA. The file opens in a new tab.`}
            </DialogDescription>
          </DialogHeader>

          {pending && (
            <div className="py-2" data-testid="app-download-details">
              <DetailRow
                label="Platform"
                value={pending.platform === "windows" ? "Windows" : "Android"}
              />
              {pending.archived && <DetailRow label="Release" value="Previous version" />}
              {pending.packageName && (
                <div data-testid="app-download-dialog-package">
                  <DetailRow label="Package" value={pending.packageName} />
                </div>
              )}
              {pending.version && <DetailRow label="Version" value={pending.version} />}
              {pending.size && <DetailRow label="Size" value={pending.size} />}
              {pending.releaseDate && <DetailRow label="Released" value={pending.releaseDate} />}
              {pending.sha256 && (
                <div className="pt-3">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    SHA-256
                  </div>
                  <code className="block text-[11px] leading-relaxed break-all font-mono text-muted-foreground bg-secondary/40 rounded-lg p-2">
                    {pending.sha256}
                  </code>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-4 flex items-start gap-2">
                <PackageIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Hosted on MEGA by the developer. Only download if you trust the source.
              </p>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPending(null)} data-testid="button-download-cancel">
              Cancel
            </Button>
            <Button onClick={confirmDownload} data-testid="button-download-confirm">
              <Download className="w-4 h-4 mr-2" />
              Continue to MEGA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
