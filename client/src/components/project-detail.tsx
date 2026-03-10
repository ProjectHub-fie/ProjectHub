import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Github, Download, Bot, ArrowLeft, Calendar, Users, Star, CheckCircle2, Heart } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface ProjectDetailProps {
  project: {
    id: string;
    slug: string;
    title: string;
    description: string;
    longDescription?: string;
    imageUrl: string;
    category: "websites" | "bots" | "utilities";
    technologies: string[];
    features: string[];
    highlights: string[];
    liveUrl?: string;
    githubUrl?: string;
    status: string;
    authorName?: string;
    architecture?: string;
    timeline?: string;
    teamSize?: string;
    userCount?: string;
    createdAt: string;
    updatedAt: string;
  };
}

export default function ProjectDetail({ project }: ProjectDetailProps) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: interactions } = useQuery<any>({
    queryKey: ["/api/projects", project.id, "interactions", user?.id],
  });

  const interactionMutation = useMutation({
    mutationFn: async (data: { isLiked?: boolean; rating?: number }) => {
      return apiRequest(`/api/projects/${project.id}/interactions`, "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id, "interactions"], exact: false });
      toast({
        title: "Success!",
        description: "Your interaction has been recorded.",
        variant: "success",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Action failed",
        description: error.message || "You must be logged in to like or rate projects.",
        variant: "error",
      });
    }
  });

  const handleLike = () => {
    if (!user) {
      toast({
        title: "Authentication required",
        description: "You must be logged in to like projects.",
        variant: "error",
      });
      return;
    }
    interactionMutation.mutate({ isLiked: interactions?.userInteraction?.isLiked !== "true" });
  };

  const handleRating = (star: number) => {
    if (!user) {
      toast({
        title: "Authentication required",
        description: "You must be logged in to rate projects.",
        variant: "error",
      });
      return;
    }
    interactionMutation.mutate({ rating: star });
  };

  const getActionIcon = (category: string) => {
    switch (category) {
      case "websites":
        return <ExternalLink className="w-4 h-4 mr-2" />;
      case "bots":
        return <Bot className="w-4 h-4 mr-2" />;
      case "utilities":
        return <Download className="w-4 h-4 mr-2" />;
      default:
        return <ExternalLink className="w-4 h-4 mr-2" />;
    }
  };

  const getActionText = (category: string) => {
    switch (category) {
      case "websites":
        return "Visit Website";
      case "bots":
        return "Add to Discord";
      case "utilities":
        return "Download";
      default:
        return "View Project";
    }
  };

  const getStatusColor = (status: string | undefined) => {
    if (!status) return "bg-gray-500";
    switch (status.toLowerCase()) {
      case "active": return "bg-green-500";
      case "developing": return "bg-red-500";
      case "live": return "bg-blue-500";
      case "beta": return "bg-yellow-500";
      case "archived": return "bg-gray-500";
      default: return "bg-gray-500";
    }
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back Button */}
        <Button
          variant="ghost"
          onClick={() => setLocation("/")}
          className="mb-8 hover-elevate"
          data-testid="button-back-to-projects"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Button>

        {/* Project Header */}
        <div className="mb-12">
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
              {project.title}
            </h1>
            <Badge className={`${getStatusColor(project.status)} text-white px-4 py-1.5 rounded-full text-sm font-semibold uppercase tracking-wider border-0 shadow-sm`}>
              {String(project.status || 'Unknown').charAt(0).toUpperCase() + String(project.status || 'unknown').slice(1)}
            </Badge>
          </div>
          <p className="text-xl text-muted-foreground leading-relaxed max-w-3xl">
            {project.longDescription || project.description}
          </p>
        </div>

        {/* Project Image */}
        <div className="relative mb-12 rounded-2xl overflow-hidden shadow-2xl border bg-card">
          <img 
            src={project.imageUrl || "/api/placeholder/800/400"}
            alt={project.title}
            className="w-full h-64 md:h-[450px] object-cover transition-transform duration-500 hover:scale-[1.02]"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = "/api/placeholder/800/400";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent"></div>
        </div>

        {/* Tech Stack */}
        {project.technologies && project.technologies.length > 0 && (
          <div className="mb-12">
            <h4 className="text-lg font-bold mb-4">Technology Stack</h4>
            <div className="flex flex-wrap gap-2">
              {project.technologies.map((tech) => (
                <Badge key={tech} variant="outline" className="px-4 py-2 text-sm font-medium">
                  {tech}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Architecture */}
        {project.architecture && (
          <div className="mb-12 p-6 bg-secondary/20 rounded-2xl border border-border/50">
            <h2 className="text-2xl font-bold mb-4">Architecture</h2>
            <p className="text-foreground leading-relaxed">{project.architecture}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 pt-8 border-t border-border/50">
          <Button 
            className="flex-1"
            onClick={() => {
              if (project.liveUrl) {
                window.open(project.liveUrl, '_blank');
              }
            }}
            disabled={!project.liveUrl}
          >
            {getActionIcon(project.category)}
            {getActionText(project.category)}
          </Button>
          
          {project.githubUrl && (
            <Button 
              variant="outline"
              onClick={() => window.open(project.githubUrl, '_blank')}
            >
              <Github className="w-4 h-4 mr-2" />
              View Source Code
            </Button>
          )}
        </div>

        {/* Interactions */}
        <div className="mt-8 pt-8 border-t border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <button 
                onClick={handleLike}
                className={`flex items-center gap-2 transition-colors ${
                  interactions?.userInteraction?.isLiked === "true" 
                    ? "text-red-500" 
                    : "text-muted-foreground hover:text-red-400"
                }`}
              >
                <Heart className={`w-5 h-5 ${interactions?.userInteraction?.isLiked === "true" ? "fill-current" : ""}`} />
                <span className="font-medium">{interactions?.likes || 0} likes</span>
              </button>
              
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => handleRating(star)}
                    className={`transition-colors ${
                      Number(interactions?.userInteraction?.rating) >= star 
                        ? "text-yellow-500" 
                        : "text-muted-foreground hover:text-yellow-400"
                    }`}
                  >
                    <Star className={`w-5 h-5 ${Number(interactions?.userInteraction?.rating) >= star ? "fill-current" : ""}`} />
                  </button>
                ))}
                {interactions?.averageRating > 0 && (
                  <span className="text-sm text-muted-foreground ml-2">
                    ({interactions.averageRating.toFixed(1)} avg)
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
