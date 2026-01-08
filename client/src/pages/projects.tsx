import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Bot, Download, ArrowLeft, Github } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Project } from "@shared/schema";

export default function ProjectsPage() {
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const filteredProjects = activeFilter === "all"
    ? projects
    : projects.filter(project => project.category === activeFilter as any);

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
                <h3 className="text-xl font-bold mb-2">{project.title}</h3>
                <p className="text-muted-foreground text-sm mb-4 line-clamp-3">
                  {project.description}
                </p>

                <div className="flex flex-wrap gap-2 mb-6">
                  {project.tech.map((tech) => (
                    <Badge key={tech} variant="outline" className="text-[10px]">
                      {tech}
                    </Badge>
                  ))}
                </div>

                <div className="flex gap-3">
                  <Button
                    className="flex-1"
                    onClick={() => project.liveUrl && window.open(project.liveUrl, '_blank')}
                    disabled={!project.liveUrl}
                  >
                    {getActionIcon(project.category)}
                    {getActionText(project.category)}
                  </Button>
                  {project.githubUrl && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => window.open(project.githubUrl, '_blank')}
                    >
                      <Github className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
