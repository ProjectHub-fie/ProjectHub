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
    title: string;
    description: string;
    longDescription: string;
    image: string;
    category: "websites" | "bots" | "utilities";
    tech: string[];
    features: string[];
    highlights: string[];
    liveUrl?: string;
    githubUrl?: string;
    status: string;
    statusColor: string;
    timeline: string;
    teamSize?: string;
    userCount?: string;
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
        variant: "destructive",
      });
    }
  });

  const handleLike = () => {
    if (!user) {
      toast({
        title: "Authentication required",
        description: "You must be logged in to like projects.",
        variant: "destructive",
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
        variant: "destructive",
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
            <Badge className={`${project.statusColor} text-white px-4 py-1.5 rounded-full text-sm font-semibold uppercase tracking-wider border-0 shadow-sm`}>
              {project.status}
            </Badge>
          </div>
          <p className="text-xl text-muted-foreground leading-relaxed max-w-3xl">
            {project.longDescription}
          </p>
        </div>

        {/* Project Image */}
        <div className="relative mb-12 rounded-2xl overflow-hidden shadow-2xl border bg-card">
          <img 
            src={project.image}
            alt={project.title}
            className="w-full h-64 md:h-[450px] object-cover transition-transform duration-500 hover:scale-[1.02]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent"></div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-4 mb-12">
          {project.liveUrl && (
            <Button
              size="lg"
              className="hover-elevate px-8"
              onClick={() => window.open(project.liveUrl, '_blank')}
              data-testid="button-live-demo"
            >
              {getActionIcon(project.category)}
              {getActionText(project.category)}
            </Button>
          )}
          {project.githubUrl && (
            <Button
              size="lg"
              variant="outline"
              className="hover-elevate px-8"
              onClick={() => window.open(project.githubUrl, '_blank')}
              data-testid="button-view-code"
            >
              <Github className="w-4 h-4 mr-2" />
              View Code
            </Button>
          )}
        </div>

        {/* Like Button */}
        <div className="flex items-center justify-center mb-8">
          <button 
            onClick={handleLike}
            className={`flex items-center gap-2 px-6 py-3 rounded-full border-2 transition-all duration-200 ${
              interactions?.userInteraction?.isLiked === "true" 
                ? "bg-red-500 text-white border-red-500 hover:bg-red-600" 
                : "bg-background text-muted-foreground border-muted-foreground/30 hover:border-red-400 hover:text-red-400"
            }`}
          >
            <Heart className={`w-5 h-5 ${interactions?.userInteraction?.isLiked === "true" ? "fill-current" : ""}`} />
            <span className="font-semibold">
              {interactions?.userInteraction?.isLiked === "true" ? "Liked" : "Like"} ({interactions?.likes || 0})
            </span>
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-10">
          {/* Project Details */}
          <Card className="hover-elevate border-muted/40 shadow-sm">
            <CardContent className="p-8">
              <h3 className="text-2xl font-bold mb-6">Project Overview</h3>
              
              <div className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Calendar className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase font-bold tracking-widest">Timeline</p>
                    <p className="font-semibold">{project.timeline}</p>
                  </div>
                </div>
                
                {project.teamSize && (
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs uppercase font-bold tracking-widest">Team Size</p>
                      <p className="font-semibold">{project.teamSize}</p>
                    </div>
                  </div>
                )}
                
                {project.userCount && (
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Star className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs uppercase font-bold tracking-widest">Users</p>
                      <p className="font-semibold">{project.userCount}</p>
                    </div>
                  </div>
                )}

                {/* Likes and Rating */}
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                    <Heart className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase font-bold tracking-widest">Likes</p>
                    <p className="font-semibold">{interactions?.likes || 0}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-yellow-500/10 flex items-center justify-center">
                    <Star className="w-5 h-5 text-yellow-500" />
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs uppercase font-bold tracking-widest">Rating</p>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            onClick={() => handleRating(star)}
                            className={`transition-colors ${Number(interactions?.userInteraction?.rating) >= star ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-400"}`}
                          >
                            <Star className={`w-4 h-4 ${Number(interactions?.userInteraction?.rating) >= star ? "fill-current" : ""}`} />
                          </button>
                        ))}
                      </div>
                      {interactions?.averageRating > 0 && (
                        <span className="text-sm text-muted-foreground">
                          ({interactions.averageRating.toFixed(1)})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <Separator className="my-8" />

              {/* Tech Stack */}
              <div>
                <h4 className="text-lg font-bold mb-4">Technology Stack</h4>
                <div className="flex flex-wrap gap-2">
                  {project.tech.map((tech) => (
                    <Badge
                      key={tech}
                      variant="secondary"
                      className="no-default-hover-elevate px-4 py-1"
                    >
                      {tech}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Features */}
          <Card className="hover-elevate border-muted/40 shadow-sm">
            <CardContent className="p-8">
              <h3 className="text-2xl font-bold mb-6">Key Features</h3>
              <div className="space-y-4">
                {project.features.map((feature, index) => (
                  <div key={index} className="flex items-start gap-4">
                    <div className="mt-1">
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    </div>
                    <p className="text-foreground/90 font-medium leading-tight">{feature}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Project Highlights */}
        {project.highlights.length > 0 && (
          <Card className="hover-elevate border-muted/40 shadow-sm mt-10">
            <CardContent className="p-8">
              <h3 className="text-2xl font-bold mb-6 text-center">Project Success Metrics</h3>
              <div className="grid md:grid-cols-2 gap-6">
                {project.highlights.map((highlight, index) => (
                  <div key={index} className="flex items-start gap-4 p-4 rounded-xl bg-primary/5 border border-primary/10">
                    <Star className="w-6 h-6 text-yellow-500 mt-0.5 flex-shrink-0" />
                    <p className="font-semibold leading-snug">{highlight}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
