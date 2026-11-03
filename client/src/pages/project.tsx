import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import ProjectDetail from "@/components/project-detail";
import AppDetail from "@/components/app-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { AppDetailSkeleton, ProjectDetailSkeleton } from "@/components/project-skeletons";
import { isInstallableApp } from "@/lib/project-display";

interface Project {
  id: string;
  slug: string;
  title: string;
  description: string;
  longDescription: string;
  imageUrl: string;
  category: "websites" | "bots" | "utilities";
  technologies: string[];
  features: string[];
  highlights: string[];
  liveUrl?: string;
  githubUrl?: string;
  status: string;
  authorName?: string;
  authorAvatar?: string;
  architecture?: string;
  timeline: string;
  teamSize?: string;
  userCount?: string;
  appVersion?: string | null;
  appSize?: string | null;
  platforms?: string[] | null;
  requirements?: string[] | null;
  releaseNotes?: string | null;
  screenshots?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ slug: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const slug = params.slug;

  // The projects list is cached under this key, so clicking through from
  // /projects already tells us the category and the matching skeleton can be
  // shown. On a direct visit the cache is empty and the generic detail
  // skeleton is used instead, since the category is not known yet.
  const cachedList = queryClient.getQueryData<Project[]>(["/api/projects"]);
  const cachedProject = cachedList?.find((entry) => entry.slug === slug);
  const showAppSkeleton = isInstallableApp(cachedProject);

  // Fetch project details from API with enhanced error handling
  const { data: project, isLoading, error, refetch } = useQuery<Project, Error>({
    queryKey: [`/api/projects/${slug}`],
    queryFn: async () => {
      if (!slug) {
        throw new Error("Project slug is required");
      }
      
      try {
        const res = await apiRequest(`/api/projects/${slug}`, "GET");
        const response = await res.json() as Project;
        if (!response || (response as any).message === "Project not found") {
          throw new Error("Project not found");
        }
        return response;
      } catch (error: any) {
        console.error("Failed to fetch project:", error);
        throw error;
      }
    },
    enabled: !!slug,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    retryDelay: 1000,
  });

  // Handle project not found
  useEffect(() => {
    if (error && (error as any).message === "Project not found") {
      setLocation("/projects");
    }
  }, [error, setLocation]);

  // Handle error display
  useEffect(() => {
    if (error && (error as any).message !== "Project not found") {
      toast({
        title: "Error loading project",
        description: "Failed to load project details. Please try again.",
        variant: "destructive",
      });
    }
  }, [error, toast]);

  if (isLoading) {
    if (showAppSkeleton) {
      return (
        <div className="min-h-screen bg-background py-8">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <Skeleton className="h-9 w-40 mb-8" />
            <AppDetailSkeleton />
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-background pt-20 px-4 pb-20">
        <div className="max-w-4xl mx-auto">
          <Skeleton className="h-8 w-1/4 mb-8" />
          <ProjectDetailSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background pt-20 px-4 pb-20">
        <div className="max-w-4xl mx-auto text-center py-12">
          <h1 className="text-2xl font-bold mb-4">Project Not Found</h1>
          <p className="text-muted-foreground mb-6">The requested project could not be found.</p>
          <Button onClick={() => setLocation("/projects")}>Back to Projects</Button>
          <Button variant="outline" className="ml-4" onClick={() => refetch()}>
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background pt-20 px-4 pb-20">
        <div className="max-w-4xl mx-auto text-center py-12">
          <h1 className="text-2xl font-bold mb-4">Project Not Available</h1>
          <p className="text-muted-foreground">This project is currently unavailable.</p>
        </div>
      </div>
    );
  }

  // Installable utilities (ClearCut) get the application-store layout; the
  // helper falls back to the web/bot layout when a utility carries no app
  // metadata, so this only diverts genuine app pages.
  if (isInstallableApp(project)) {
    return <AppDetail project={project} />;
  }

  return (
    <div className="min-h-screen bg-background pt-20 px-4 pb-20">
      <div className="max-w-4xl mx-auto">
        <Button 
          variant="ghost" 
          className="mb-8 hover:bg-primary/10"
          onClick={() => setLocation("/projects")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Button>

        <ProjectDetail project={project} />
      </div>
    </div>
  );
}

function getStatusColorClass(status: string): string {
  switch (status.toLowerCase()) {
    case "active": return "bg-green-500";
    case "developing": return "bg-red-500";
    case "live": return "bg-blue-500";
    case "beta": return "bg-yellow-500";
    case "archived": return "bg-gray-500";
    default: return "bg-gray-500";
  }
}
