import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Download,
  Github,
  ExternalLink,
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
} from "lucide-react";
import { useLocation } from "wouter";
import { ProjectInteractions } from "@/components/project-interactions";
import {
  nonEmpty,
  githubLatestReleaseUrl,
  repoUrl,
  installLabel as appInstallLabel,
  type ProjectCategory,
} from "@/lib/project-display";

/**
 * Application-store style detail page for installable utilities.
 *
 * The web/bot layout leads with prose and an action button; an app page leads
 * with identity (icon, name, developer), then install facts (version, size,
 * platforms, rating), then a screenshot gallery, then "what's new" and the
 * permission/requirements list — the order a store listing uses. Rendered only
 * when `isInstallableApp()` is true, so utilities without app metadata keep the
 * ordinary layout.
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

export default function AppDetail({ project }: AppDetailProps) {
  const [, setLocation] = useLocation();

  const screenshots = nonEmpty(project.screenshots);
  const platforms = nonEmpty(project.platforms);
  const requirements = nonEmpty(project.requirements);
  const features = nonEmpty(project.features);
  const highlights = nonEmpty(project.highlights);
  const technologies = nonEmpty(project.technologies);

  const releaseUrl = githubLatestReleaseUrl(project.githubUrl);
  const sourceUrl = repoUrl(project.githubUrl);
  const installUrl = project.liveUrl || releaseUrl;
  const installLabel = project.liveUrl ? "Open in browser" : appInstallLabel(project);

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

        {/* Store header: icon, name, developer, install facts, primary action */}
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

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                size="lg"
                className="sm:w-auto"
                onClick={() => { if (installUrl) window.open(installUrl, "_blank"); }}
                disabled={!installUrl}
                data-testid="button-app-install"
              >
                <Download className="w-4 h-4 mr-2" />
                {installLabel}
              </Button>
              {sourceUrl && (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => window.open(sourceUrl, "_blank")}
                  data-testid="button-app-source"
                >
                  <Github className="w-4 h-4 mr-2" />
                  Source Code
                </Button>
              )}
            </div>
            {!project.liveUrl && releaseUrl && (
              <p className="text-xs text-muted-foreground mt-2">
                Downloads the latest release APK from GitHub Releases.
              </p>
            )}
          </div>
        </div>

        {/* Install facts strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6 rounded-2xl border bg-card mb-10" data-testid="app-facts">
          {project.appVersion && (
            <Fact icon={<Tag className="w-4 h-4" />} label="Version" value={project.appVersion} />
          )}
          {project.appSize && (
            <Fact icon={<HardDrive className="w-4 h-4" />} label="Size" value={project.appSize} />
          )}
          <Fact
            icon={<Cpu className="w-4 h-4" />}
            label="Platforms"
            value={platforms.length > 0 ? platforms.join(", ") : "Not specified"}
          />
          <Fact
            icon={<ShieldCheck className="w-4 h-4" />}
            label="Updated"
            value={project.timeline || "Ongoing"}
          />
        </div>

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
        <div className="flex flex-col sm:flex-row gap-4 mt-12 pt-8 border-t border-border/50">
          <Button
            className="flex-1"
            onClick={() => { if (installUrl) window.open(installUrl, "_blank"); }}
            disabled={!installUrl}
          >
            <Download className="w-4 h-4 mr-2" />
            {installLabel}
          </Button>
          {sourceUrl && (
            <Button variant="outline" onClick={() => window.open(sourceUrl, "_blank")}>
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
    </div>
  );
}
