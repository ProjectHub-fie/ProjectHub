import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import ProjectDetail from "@/components/project-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

function ProjectSkeleton() {
  return (
    <div className="min-h-screen bg-background pt-20 px-4 pb-20">
      <div className="max-w-4xl mx-auto">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/4 mb-8"></div>
          <div className="bg-card rounded-2xl overflow-hidden border border-border">
            <div className="h-64 bg-muted"></div>
            <div className="p-8 space-y-6">
              <div className="h-8 bg-muted rounded w-3/4"></div>
              <div className="space-y-3">
                <div className="h-4 bg-muted rounded"></div>
                <div className="h-4 bg-muted rounded w-5/6"></div>
                <div className="h-4 bg-muted rounded w-4/6"></div>
              </div>
              <div className="flex gap-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-6 bg-muted rounded w-16"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  createdAt: string;
  updatedAt: string;
}

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ slug: string }>();
  const { toast } = useToast();
  const slug = params.slug;

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
    return (
      <div className="min-h-screen bg-background pt-20 px-4 pb-20">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-muted rounded w-1/4 mb-8"></div>
            <div className="bg-card rounded-2xl overflow-hidden border border-border">
              <div className="h-64 bg-muted"></div>
              <div className="p-8 space-y-6">
                <div className="h-8 bg-muted rounded w-3/4"></div>
                <div className="space-y-3">
                  <div className="h-4 bg-muted rounded"></div>
                  <div className="h-4 bg-muted rounded w-5/6"></div>
                  <div className="h-4 bg-muted rounded w-4/6"></div>
                </div>
                <div className="flex gap-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-6 bg-muted rounded w-16"></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
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
