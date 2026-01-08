import { useRoute } from "wouter";
import ProjectDetail from "@/components/project-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Project } from "@shared/schema";

function ProjectSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-12 space-y-12">
        <div className="flex flex-col md:flex-row gap-8">
          <div className="w-full md:w-1/2">
            <Skeleton className="aspect-video w-full rounded-2xl" />
          </div>
          <div className="w-full md:w-1/2 space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-4 w-1/4" />
            </div>
            <Skeleton className="h-24 w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 w-20" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const [match, params] = useRoute("/project/:id");

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ["/api/projects", params?.id],
    enabled: !!params?.id,
  });

  if (isLoading) {
    return <ProjectSkeleton />;
  }

  if (!match || !params?.id || !project) {
    return <div>Project not found</div>;
  }

  return <ProjectDetail project={project} />;
}