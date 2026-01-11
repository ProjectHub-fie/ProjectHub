import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Github, Download, Bot, BarChart3, Terminal, User, Network } from "lucide-react";
import { useLocation } from "wouter";

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
  };
}

const projects: Project[] = [
  {
    id: "PrimeBot",
    title: "PrimeBot",
    description: "PrimeBot is a sleek, multipurpose Discord bot built to supercharge your server with essential tools. It features a dynamic giveaway system with customizable entries, interactive polls for instant feedback, and a ticket system for seamless support handling.",
    image: "/primebot.gif",
    category: "bots",
    tech: ["discord.js", "C"," mySQL"],
    liveUrl: "https://discord.com/oauth2/authorize?client_id=1356575287151951943&permissions=8&integration_type=0&scope=bot%20applications.commands",
    status: " Active",
    statusColor: "bg-green-500",
    author: { name: "Team ProjectHub" },
    architecture: "Multi-sharded microservices architecture with a centralized command handler."
  },
  {
    id: "pbo",
    title: "PrimeBot",
    description: "Interactive and dynamic website with dashboard of PrimeBot discord bot (Dashboard will come soon)",
    image: "/primebot.gif",
    category: "websites",
    tech: ["Typescript React", "Node.js", "PostgreSQL"],
    liveUrl: "https://primebot-online.vercel.app",
    status: "In development",
    statusColor: "bg-red-500",
    author: { name: "Team ProjectHub" },
    architecture: "React-based frontend with a Node.js backend using a micro-frontend approach."
  },
  {
    id: "Sky",
    title: "Sky",
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
    architecture: "Client-server architecture utilizing direct PostgreSQL connection protocols."
  },
  {
    id: "wh",
    title: "Hosting ",
    description: "Discord bot hosting",
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

export default function ProjectsSection() {
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const filteredProjects = activeFilter === "all"
    ? projects
    : projects.filter(project => project.category === activeFilter);

  const getActionIcon = (category: Project["category"]) => {
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

  const getActionText = (category: Project["category"]) => {
    switch (category) {
      case "websites":
        return "Live Demo";
      case "bots":
        return "Add Bot";
      case "utilities":
        return "Download";
      default:
        return "View";
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
              className={`px-6 py-3 rounded-xl font-medium transition-all duration-300 bg-blue-300 ${
                activeFilter === filter.key
                  ? "bg-primary text-primary-foreground hover:bg-blue-500"
                  : "bg-secondary text-secondary-foreground hover:bg-blue-600"
              }`}
              data-testid={`filter-${filter.key}`}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredProjects.map((project) => (
            <div
              key={project.id}
              className="group bg-card rounded-2xl overflow-hidden border border-border hover:border-primary/50 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl cursor-pointer"
              onClick={() => setLocation(`/project/${project.id}`)}
              data-testid={`project-card-${project.id}`}
            >
              <div className="relative overflow-hidden">
                <img
                  src={project.image}
                  alt={project.title}
                  className="w-full h-48 object-cover group-hover:scale-110 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                <div className={`absolute top-4 right-4 ${project.statusColor} text-white px-3 py-1 rounded-full text-sm font-medium`}>
                  {project.status}
                </div>
              </div>

              <div className="p-6">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors duration-300">
                    {project.title}
                  </h3>
                  {project.author && (
                    <div className="flex items-center gap-2 bg-secondary/50 px-2 py-1 rounded-lg text-[10px] text-muted-foreground">
                      <User className="w-3 h-3" />
                      <span>{project.author.name}</span>
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
                  {project.tech.map((tech) => (
                    <Badge
                      key={tech}
                      variant="outline"
                      className="bg-primary/20 text-primary border-primary/30 px-3 py-1 rounded-full text-xs font-medium"
                    >
                      {tech}
                    </Badge>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4">
                  <Button
                    className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground py-2 rounded-lg font-medium transition-colors duration-200"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (project.liveUrl) window.open(project.liveUrl, '_blank');
                    }}
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
              </div>
            </div>
          ))}
        </div>

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
              data-testid="button-load-more"
            >
              Back to Top
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
