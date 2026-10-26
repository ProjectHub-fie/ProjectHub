import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared loading skeletons for project surfaces.
 *
 * The three places that fetch `/api/projects` — the projects section, the all
 * projects page and the project detail page — each used to hand-roll a copy of
 * this markup. Keep the shapes here so a loading card cannot drift from the
 * rendered card it is a placeholder for.
 */

export function ProjectCardSkeleton() {
  return (
    <div className="bg-card rounded-2xl overflow-hidden border border-border">
      <Skeleton className="h-48 rounded-none" />
      <div className="p-6 space-y-4">
        <div className="flex justify-between items-start gap-4">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-12 shrink-0" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="flex gap-3 pt-2">
          <Skeleton className="h-10 flex-1 rounded-lg" />
          <Skeleton className="h-10 w-10 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function ProjectsGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
      data-testid="projects-loading-skeleton"
      aria-hidden="true"
      role="status"
      aria-label="Loading projects"
    >
      {Array.from({ length: count }, (_, i) => (
        <ProjectCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ProjectDetailSkeleton() {
  return (
    <div className="space-y-12">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-5/6" />
      </div>
      <Skeleton className="h-64 md:h-[450px] rounded-2xl" />
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-4 pt-4">
        <Skeleton className="h-11 flex-1 rounded-lg" />
        <Skeleton className="h-11 w-44 rounded-lg" />
      </div>
    </div>
  );
}