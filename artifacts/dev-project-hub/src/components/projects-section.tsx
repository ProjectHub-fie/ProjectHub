import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Github, Download, Bot, Network, User, Heart, Star } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

function ProjectInteractions({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: interactions } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "interactions", user?.id],
  });

  const interactionMutation = useMutation({
    mutationFn: async (data: { isLiked?: boolean; rating?: number }) => {
      return apiRequest(`/api/projects/${projectId}/interactions`, "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "interactions"] });
      toast({ title: "Success", description: "Your interaction has been recorded.", variant: "success" });
    },
    onError: (error: any) => {
      toast({ title: "Action failed", description: error.message || "You must be logged in to like or rate projects.", variant: "error" });
    }
  });

  const handleLike = () => {
    if (!user) {
      toast({ title: "Authentication required", description: "You must be logged in to like projects.", variant: "error" });
      return;
    }
    interactionMutation.mutate({ isLiked: interactions?.userInteraction?.isLiked !== true });
  };

  const handleRating = (star: number) => {
    if (!user) {
      toast({ title: "Authentication required", description: "You must be logged in to rate projects.", variant: "error" });
      return;
    }
    interactionMutation.mutate({ rating: star });
  };

  return (
    <div className="flex items-center gap-4 mt-4 py-2 border-t border-border/50">
      <button
        onClick={(e) => { e.stopPropagation(); handleLike(); }}
        className={`flex items-center gap-1 transition-colors ${interactions?.userInteraction?.isLiked ? "text-red-500" : "text-muted-foreground hover:text-red-400"}`}
      >
        <Heart className={`w-4 h-4 ${interactions?.userInteraction?.isLiked ? "fill-current" : ""}`} />
        <span className="text-xs font-medium">{interactions?.likes || 0}</span>
      </button>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={(e) => { e.stopPropagation(); handleRating(star); }}
            className={`transition-colors ${Number(interactions?.userInteraction?.rating) >= star ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-400"}`}
          >
            <Star className={`w-3 h-3 ${Number(interactions?.userInteraction?.rating) >= star ? "fill-current" : ""}`} />
          </button>
        ))}
        {interactions?.averageRating > 0 && (
          <span className="text-[10px] text-muted-foreground ml-1">({interactions.averageRating.toFixed(1)})</span>
        )}
      </div>
    </div>
  );
}

interface Project {
  id: string;
  slug: string;
  title: string;
  description: string;
  imageUrl: string | null;
  category: "websites" | "bots" | "utilities";
  technologies: string[] | null;
  liveUrl?: string | null;
  githubUrl?: string | null;
  status: string;
  authorName?: string | null;
  architecture?: string | null;
}

const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case "active": return "bg-green-500";
    case "developing": return "bg-red-500";
    case "live": return "bg-blue-500";
    case "beta": return "bg-yellow-500";
    case "archived": return "bg-gray-500";
    default: return "bg-gray-500";
  }
};

const getStatusLabel = (status: string) => {
  return status.charAt(0).toUpperCase() + status.slice(1);
};

export default function ProjectsSection() {
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    staleTime: 5 * 60 * 1000,
  });

  const filteredProjects = activeFilter === "all"
    ? projects
    : projects.filter(project => project.category === activeFilter);

  const getActionIcon = (category: Project["category"]) => {
    switch (category) {
      case "websites": return <ExternalLink className="w-4 h-4 mr-2" />;
      case "bots": return <Bot className="w-4 h-4 mr-2" />;
      case "utilities": return <Download className="w-4 h-4 mr-2" />;
      default: return <ExternalLink className="w-4 h-4 mr-2" />;
    }
  };

  const getActionText = (category: Project["category"]) => {
    switch (category) {
      case "websites": return "Live Demo";
      case "bots": return "Add Bot";
      case "utilities": return "Download";
      default: return "View";
    }
  };

  return (
    <section id="projects" className="py-20 bg-muted/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-500">
              Featured Projects
            </span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Explore our latest work in web development, automation, and developer tools
          </p>
        </div>

        {/* Project Filters */}
        <div className="flex flex-wrap justify-center gap-4 mb-12">
          {[
            { key: "all", label: "All Projects" },
            { key: "websites", label: "Websites" },
            { key: "bots", label: "Bots" },
            { key: "utilities", label: "Utilities" }
          ].map((filter) => (
            <Button
              key={filter.key}
              onClick={() => setActiveFilter(filter.key)}
              className={`px-6 py-3 rounded-xl font-medium transition-all duration-300 ${
                activeFilter === filter.key
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-secondary text-secondary-foreground hover:bg-blue-600 hover:text-white"
              }`}
              data-testid={`filter-${filter.key}`}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-card rounded-2xl overflow-hidden border border-border h-96 animate-pulse">
                <div className="h-48 bg-muted"></div>
                <div className="p-6 space-y-4">
                  <div className="h-6 bg-muted rounded w-3/4"></div>
                  <div className="h-4 bg-muted rounded w-full"></div>
                  <div className="h-4 bg-muted rounded w-2/3"></div>
                  <div className="flex gap-2">
                    <div className="h-6 bg-muted rounded w-16"></div>
                    <div className="h-6 bg-muted rounded w-16"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Projects Grid */}
        {!isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="group bg-card rounded-2xl overflow-hidden border border-border hover:border-primary/50 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl cursor-pointer"
                onClick={() => setLocation(`/project/${project.slug}`)}
                data-testid={`project-card-${project.id}`}
              >
                <div className="relative overflow-hidden">
                  <img
                    src={project.imageUrl || "/api/placeholder/400/300"}
                    alt={project.title}
                    className="w-full h-48 object-cover group-hover:scale-110 transition-transform duration-500"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = "/api/placeholder/400/300";
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  <div className={`absolute top-4 right-4 ${getStatusColor(project.status)} text-white px-3 py-1 rounded-full text-sm font-medium`}>
                    {getStatusLabel(project.status)}
                  </div>
                </div>

                <div className="p-6">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors duration-300">
                      {project.title}
                    </h3>
                    {project.authorName && (
                      <div className="flex items-center gap-2 bg-secondary/50 px-2 py-1 rounded-lg text-[10px] text-muted-foreground">
                        <User className="w-3 h-3" />
                        <span>{project.authorName}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-muted-foreground mb-4 text-sm leading-relaxed line-clamp-2">
                    {project.description}
                  </p>

                  {project.architecture && (
                    <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                      <div className="flex items-center gap-2 text-blue-400 font-semibold text-[10px] mb-1">
                        <Network className="w-3 h-3" />
                        Architecture
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">
                        {project.architecture}
                      </p>
                    </div>
                  )}

                  {/* Tech Stack */}
                  <div className="flex flex-wrap gap-2 mb-6">
                    {project.technologies?.slice(0, 4).map((tech) => (
                      <Badge
                        key={tech}
                        variant="outline"
                        className="bg-primary/20 text-primary border-primary/30 px-3 py-1 rounded-full text-xs font-medium"
                      >
                        {tech}
                      </Badge>
                    ))}
                    {project.technologies && project.technologies.length > 4 && (
                      <Badge variant="outline" className="text-[10px]">
                        +{project.technologies.length - 4} more
                      </Badge>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-4">
                    <Button
                      className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground py-2 rounded-lg font-medium transition-colors duration-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (project.liveUrl) window.open(project.liveUrl, '_blank');
                      }}
                      disabled={!project.liveUrl}
                      data-testid={`button-demo-${project.id}`}
                    >
                      {getActionIcon(project.category)}
                      {getActionText(project.category)}
                    </Button>
                    {project.githubUrl && (
                      <Button
                        variant="outline"
                        className="flex-1 border border-border hover:border-primary hover:text-primary text-foreground py-2 rounded-lg font-medium transition-all duration-200 bg-transparent"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (project.githubUrl) window.open(project.githubUrl, '_blank');
                        }}
                        data-testid={`button-code-${project.id}`}
                      >
                        <Github className="w-4 h-4 mr-2" />
                        Code
                      </Button>
                    )}
                  </div>
                  <ProjectInteractions projectId={project.id} />
                </div>
              </div>
            ))}

            {filteredProjects.length === 0 && !isLoading && (
              <div className="col-span-3 text-center py-12 text-muted-foreground">
                {activeFilter === "all" ? "No projects found" : `No ${activeFilter} projects found`}
              </div>
            )}
          </div>
        )}

        {/* View All Projects Button */}
        <div className="text-center mt-12 space-y-4">
          <Button
            className="bg-gradient-to-r from-blue-500 to-violet-500 text-white px-10 py-6 rounded-xl font-bold text-lg hover:shadow-xl hover:shadow-blue-500/25 transition-all duration-300 hover:-translate-y-1"
            onClick={() => setLocation("/projects")}
            data-testid="button-view-all-projects"
          >
            View All Projects
          </Button>
          <div>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-primary"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              data-testid="button-back-to-top"
            >
              Back to Top
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
