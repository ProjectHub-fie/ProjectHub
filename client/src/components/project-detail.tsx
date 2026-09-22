import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Github, Download, Bot, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { ProjectInteractions } from "@/components/project-interactions";

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
          <ProjectInteractions projectId={project.id} size="lg" />
        </div>
      </div>
    </div>
  );
}
