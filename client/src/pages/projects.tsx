import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Bot, Download, ArrowLeft, Github, Network, User, Heart, Star } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

function ProjectInteractions({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: interactions } = useQuery<any>({
    queryKey: ["/api/projects", projectId, "interactions"],
  });

  const interactionMutation = useMutation({
    mutationFn: async (data: { isLiked?: boolean; rating?: number }) => {
      return apiRequest(`/api/projects/${projectId}/interactions`, "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "interactions"] });
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

  return (
    <div className="flex items-center gap-4 mt-4 py-2 border-t border-border/50">
      <button 
        onClick={(e) => {
          e.stopPropagation();
          interactionMutation.mutate({ isLiked: interactions?.userInteraction?.isLiked !== "true" });
        }}
        className={`flex items-center gap-1 transition-colors ${interactions?.userInteraction?.isLiked === "true" ? "text-red-500" : "text-muted-foreground hover:text-red-400"}`}
      >
        <Heart className={`w-4 h-4 ${interactions?.userInteraction?.isLiked === "true" ? "fill-current" : ""}`} />
        <span className="text-xs font-medium">{interactions?.likes || 0}</span>
      </button>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={(e) => {
              e.stopPropagation();
              interactionMutation.mutate({ rating: star });
            }}
            className={`transition-colors ${Number(interactions?.userInteraction?.rating) >= star ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-400"}`}
          >
            <Star className={`w-3 h-3 ${Number(interactions?.userInteraction?.rating) >= star ? "fill-current" : ""}`} />
          </button>
        ))}
        {interactions?.averageRating > 0 && (
          <span className="text-[10px] text-muted-foreground ml-1">
            ({interactions.averageRating.toFixed(1)})
          </span>
        )}
      </div>
    </div>
  );
}

interface Project {
  id: string;
  title: string;
  description: string;
  image: string;
  category: "websites" | "bots" | "utilities";
  tech: string[];
  liveUrl?: string;
  githubUrl?: string;
  status: string;
  statusColor: string;
  architecture?: string;
  author?: {
    name: string;
    avatar?: string;
  };
}

const projects: Project[] = [
  {
    id: "PrimeBot",
    title: "PrimeBot",
    description: "PrimeBot is a sleek, multipurpose Discord bot built to supercharge your server with essential tools. It features a dynamic giveaway system with customizable entries, interactive polls for instant feedback, and a ticket system for seamless support handling.",
    image: "/primebot.gif",
    category: "bots",
    tech: ["discord.js", "C"," PostgreeSQL"],
    liveUrl: "https://discord.com/oauth2/authorize?client_id=1356575287151951943&permissions=8&integration_type=0&scope=bot%20applications.commands",
    status: " Active",
    statusColor: "bg-green-500",
    author: { name: "Team ProjectHub" },
    architecture: "Multi-sharded microservices architecture with a centralized command handler and persistent MySQL storage."
  },
  {
    id: "pbo",
    title: "PrimeBot Dashboard",
    description: "Interactive and dynamic website with dashboard of PrimeBot discord bot (Dashboard will come soon)",
    image: "/primebot.gif",
    category: "websites",
    tech: ["Typescript React", "Node.js", "PostgreSQL"],
    liveUrl: "https://primebot-online.vercel.app",
    status: "In development",
    statusColor: "bg-red-500",
    author: { name: "Team ProjectHub" },
    architecture: "React-based frontend with a Node.js backend using a micro-frontend approach for dashboard modules."
  },
  {
    id: "Sky",
    title: "Sky Bot",
    description: "Collaborative task management application with real-time updates, team collaboration features, and project tracking capabilities.",
    image: "/api/placeholder/400/300",
    category: "bots",
    tech: ["Discord.js"],
    liveUrl: "",
    status: "Active",
    statusColor: "bg-green-500",
    author: { name: "Raj Roy" }
  },
  {
    id: "db",
    title: "Database Dashboard",
    description: "Online based database dashboard for your PostgreeSQL.",
    image: "/api/placeholder/400/300",
    category: "websites",
    tech: ["Typescript","React"],
    liveUrl: "",
    githubUrl: "https://github.com/rajroy1313/Database-web.git",
    status: "Developing",
    statusColor: "bg-red-500",
    author: { name: "Raj Roy" },
    architecture: "Client-server architecture utilizing direct PostgreSQL connection protocols via secured tunneling for real-time data visualization."
  },
  {
    id: "wh",
    title: "Hosting ",
    description: "Discord bot hosting platform",
    image: "/api/placeholder/400/300",
    category: "websites",
    tech: ["React", "Typescript", "PostgreSQL"],
    liveUrl: "",
    githubUrl: "https://github.com/rajroy1313/Webhost.git",
    status: "In development",
    statusColor: "bg-red-500",
    author: { name: "Raj Roy" }
  }
];

export default function ProjectsPage() {
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState<string>("all");

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
    <div className="min-h-screen bg-background pt-20 px-4 pb-20">
      <div className="max-w-6xl mx-auto">
        <Button 
          variant="ghost" 
          className="mb-8 hover:bg-primary/10"
          onClick={() => setLocation("/")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Button>

        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-500">
              All Projects
            </span>
          </h1>
          <p className="text-xl text-muted-foreground">
            A comprehensive list of all our creations and developments
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-4 mb-12">
          {[
            { key: "all", label: "All Projects" },
            { key: "websites", label: "Websites" },
            { key: "bots", label: "Bots" },
            { key: "utilities", label: "Utilities" }
          ].map((filter) => (
            <Button
              key={filter.key}
              variant={activeFilter === filter.key ? "default" : "secondary"}
              onClick={() => setActiveFilter(filter.key)}
              className="rounded-xl px-6"
            >
              {filter.label}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredProjects.map((project) => (
            <div
              key={project.id}
              className="group bg-card rounded-2xl overflow-hidden border border-border hover:border-primary/50 transition-all duration-300 hover:-translate-y-2"
            >
              <div className="relative h-48 overflow-hidden">
                <img
                  src={project.image}
                  alt={project.title}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                />
                <div className={`absolute top-4 right-4 ${project.statusColor} text-white px-3 py-1 rounded-full text-xs font-medium`}>
                  {project.status}
                </div>
              </div>

              <div className="p-6">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-xl font-bold">{project.title}</h3>
                  {project.author && (
                    <div className="flex items-center gap-2 bg-secondary/50 px-2 py-1 rounded-lg text-[10px] text-muted-foreground">
                      <User className="w-3 h-3" />
                      <span>{project.author.name}</span>
                    </div>
                  )}
                </div>
                <p className="text-muted-foreground text-sm mb-4 line-clamp-3">
                  {project.description}
                </p>

                {project.architecture && (
                  <div className="mb-4 p-3 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                    <div className="flex items-center gap-2 text-blue-400 font-semibold text-xs mb-1">
                      <Network className="w-3 h-3" />
                      Architecture
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {project.architecture}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mb-6">
                  {project.tech.map((tech) => (
                    <Badge key={tech} variant="outline" className="text-[10px]">
                      {tech}
                    </Badge>
                  ))}
                </div>

                <ProjectInteractions projectId={project.id} />
                <div className="flex flex-col gap-3 mt-4">
                  <div className="flex gap-3">
                    <Button
                      className="flex-1"
                      onClick={() => setLocation(`/project/${project.id}`)}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      View Details
                    </Button>
                    {project.githubUrl && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        onClick={() => window.open(project.githubUrl, '_blank')}
                      >
                        <Github className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => project.liveUrl && window.open(project.liveUrl, '_blank')}
                    disabled={!project.liveUrl}
                  >
                    {getActionIcon(project.category)}
                    {getActionText(project.category)}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
