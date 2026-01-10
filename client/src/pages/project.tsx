import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import ProjectDetail from "@/components/project-detail";
import { Skeleton } from "@/components/ui/skeleton";

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

interface Project {
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
}

const projects: Project[] = [
  {
    id: "PrimeBot",
    title: "PrimeBot",
    description: "PrimeBot is a sleek, multipurpose Discord bot built to supercharge your server with essential tools.",
    longDescription: "PrimeBot is a comprehensive Discord bot designed to enhance server functionality with a complete suite of moderation, entertainment, and utility features. Built with performance and reliability in mind, it serves thousands of Discord servers with 99.9% uptime. It features a robust architecture that handles high concurrent users and provides a seamless management experience through its companion dashboard.",
    image: "/primebot.gif",
    category: "bots",
    tech: ["Discord.js", "Node.js", "MySQL", "Docker", "Redis", "TypeScript", "Express"],
    features: [
      "Dynamic giveaway system with customizable entry requirements",
      "Interactive polls with real-time voting and analytics",
      "Advanced ticket system with category support and logs",
      "Gaming commands including trivia, dice, and mini-games",
      "Comprehensive moderation tools (ban, kick, mute, warn)",
      "Full emoji management suite with bulk upload/delete",
      "Custom command creation and scripting",
      "Role management and auto-role assignment",
      "Welcome/goodbye message system with embeds",
      "Server analytics and activity tracking"
    ],
    highlights: [
      "Serving 500+ Discord servers with 50K+ active users",
      "99.9% uptime with distributed hosting infrastructure",
      "Processed over 1M+ commands successfully",
      "Featured in Discord Bot Lists with 4.8/5 star rating",
      "Optimized for low latency and high performance"
    ],
    liveUrl: "https://discord.com/oauth2/authorize?client_id=1352315703830773863&permissions=8&integration_type=0&scope=bot",
    githubUrl: "https://github.com/yuborajroy/primebot",
    status: "Active",
    statusColor: "bg-green-500",
    timeline: "6 months development",
    teamSize: "Solo project",
    userCount: "50,000+ active users"
  },
  {
    id: "pbo",
    title: "PrimeBot Dashboard",
    description: "Interactive and dynamic website with dashboard for PrimeBot discord bot management.",
    longDescription: "A comprehensive web dashboard for PrimeBot that allows server administrators to configure bot settings, view analytics, manage giveaways, and monitor server activity through an intuitive interface.",
    image: "/primebot.gif",
    category: "websites",
    tech: ["TypeScript", "React", "Node.js", "PostgreSQL", "TailwindCSS"],
    features: [
      "Real-time server analytics and user engagement metrics",
      "Giveaway management with participant tracking",
      "Custom command builder with syntax highlighting",
      "Role and permission management interface",
      "Ticket system administration panel",
      "Bot configuration with live preview",
      "Audit logs and moderation history",
      "Server member insights and activity graphs",
      "Custom embed designer for announcements",
      "API integration for external services"
    ],
    highlights: [
      "Modern React-based dashboard with real-time updates",
      "OAuth integration with Discord for secure authentication",
      "Mobile-responsive design for on-the-go management",
      "Comprehensive admin tools for server management"
    ],
    liveUrl: "https://primebot-online.vercel.app",
    githubUrl: "https://github.com/yourusername/primebot-dashboard",
    status: "Development",
    statusColor: "bg-yellow-500",
    timeline: "3 months development",
    teamSize: "Solo project",
    userCount: "1,000+ dashboard users"
  },
  {
    id: "Sky",
    title: "Sky Task Manager",
    description: "Collaborative task management application with real-time updates and team collaboration features.",
    longDescription: "Sky is a modern task management platform that brings teams together with real-time collaboration, advanced project tracking, and intelligent workflow automation. Designed for productivity and ease of use.",
    image: "/api/placeholder/400/300",
    category: "websites",
    tech: ["React", "Socket.io", "MongoDB", "Express", "JWT", "Redis"],
    features: [
      "Real-time collaborative task editing and updates",
      "Advanced project timeline and milestone tracking",
      "Team chat integration with file sharing",
      "Automated workflow triggers and notifications",
      "Customizable project templates and boards",
      "Time tracking and productivity analytics",
      "Role-based access control and permissions",
      "Integration with popular tools (Slack, GitHub, Jira)",
      "Mobile app with offline sync capabilities",
      "Advanced reporting and team performance metrics"
    ],
    highlights: [
      "Real-time synchronization across all devices",
      "Scalable architecture supporting 10,000+ concurrent users",
      "Advanced analytics with machine learning insights",
      "Enterprise-grade security with end-to-end encryption"
    ],
    liveUrl: "https://yourtasks.com",
    githubUrl: "https://github.com/yourusername/taskmanager",
    status: "Live",
    statusColor: "bg-green-500",
    timeline: "8 months development",
    teamSize: "3 developers",
    userCount: "5,000+ active teams"
  },
  {
    id: "weather-dashboard",
    title: "Weather Dashboard",
    description: "Interactive weather dashboard with location-based forecasts and severe weather alerts.",
    longDescription: "A comprehensive weather application that provides detailed forecasts, historical data analysis, and severe weather monitoring with beautiful data visualizations and location-based services.",
    image: "/api/placeholder/400/300",
    category: "websites",
    tech: ["React", "Chart.js", "OpenWeather API", "Geolocation", "PWA"],
    features: [
      "7-day detailed weather forecasts with hourly breakdowns",
      "Interactive weather maps with radar and satellite imagery",
      "Severe weather alerts and emergency notifications",
      "Historical weather data analysis and trends",
      "Location-based automatic weather updates",
      "Air quality index monitoring and health recommendations",
      "UV index tracking with sun safety alerts",
      "Weather widgets for embedding in other applications",
      "Offline capability with cached forecast data",
      "Multiple location tracking and comparison"
    ],
    highlights: [
      "Progressive Web App with native-like experience",
      "Real-time weather data from multiple reliable sources",
      "Beautiful data visualizations with interactive charts",
      "Accurate severe weather alerting system"
    ],
    liveUrl: "https://yourweather.com",
    githubUrl: "https://github.com/yourusername/weather-dashboard",
    status: "Live",
    statusColor: "bg-green-500",
    timeline: "4 months development",
    teamSize: "Solo project",
    userCount: "2,000+ daily users"
  },
  {
    id: "blog-platform",
    title: "Modern Blog Platform",
    description: "Content management system with markdown support, SEO optimization, and analytics dashboard.",
    longDescription: "A powerful blogging platform that combines the simplicity of markdown writing with advanced SEO tools, comprehensive analytics, and a modern content management system designed for professional bloggers and content creators.",
    image: "/api/placeholder/400/300",
    category: "websites",
    tech: ["React", "Next.js", "Prisma", "PostgreSQL", "MDX", "Stripe"],
    features: [
      "Rich markdown editor with live preview and syntax highlighting",
      "Advanced SEO optimization with meta tag management",
      "Built-in analytics dashboard with reader insights",
      "Comment system with moderation and spam protection",
      "Newsletter integration with subscriber management",
      "Social media auto-posting and cross-platform sharing",
      "Custom theme builder with drag-and-drop interface",
      "Multi-author support with role-based permissions",
      "Scheduled publishing and content calendar",
      "Monetization tools with subscription and paywall support"
    ],
    highlights: [
      "Lightning-fast static site generation with Next.js",
      "SEO-optimized with 95+ PageSpeed Insights score",
      "Integrated payment processing for premium content",
      "Advanced analytics with reader behavior tracking"
    ],
    liveUrl: "https://yourblog.com",
    githubUrl: "https://github.com/yourusername/blog-platform",
    status: "Development",
    statusColor: "bg-yellow-500",
    timeline: "5 months development",
    teamSize: "2 developers",
    userCount: "500+ content creators"
  },
  {
    id: "fitness-tracker",
    title: "Fitness Tracking Website",
    description: "Personal fitness tracking application with workout logging and progress visualization.",
    longDescription: "A comprehensive fitness tracking platform that helps users achieve their health goals through detailed workout logging, nutrition tracking, progress visualization, and social motivation features.",
    image: "/api/placeholder/400/300",
    category: "websites",
    tech: ["React", "D3.js", "Firebase", "PWA", "Service Workers", "TensorFlow.js"],
    features: [
      "Comprehensive workout logging with exercise database",
      "Nutrition tracking with barcode scanning and meal planning",
      "Progress visualization with interactive charts and graphs",
      "Social features for sharing achievements and motivation",
      "AI-powered workout recommendations based on goals",
      "Wearable device integration (Fitbit, Apple Watch, Garmin)",
      "Custom workout plan creation and sharing",
      "Body measurement tracking with photo progress",
      "Challenges and leaderboards for community engagement",
      "Offline workout tracking with sync capabilities"
    ],
    highlights: [
      "AI-powered personal trainer recommendations",
      "Integration with 15+ popular fitness wearables",
      "Progressive Web App with offline workout tracking",
      "Community of 10,000+ fitness enthusiasts"
    ],
    liveUrl: "https://yourfitness.com",
    githubUrl: "https://github.com/yourusername/fitness-tracker",
    status: "Beta",
    statusColor: "bg-blue-500",
    timeline: "7 months development",
    teamSize: "4 developers",
    userCount: "10,000+ fitness enthusiasts"
  },
  {
    id: "db",
    title: "Database Dashboard",
    description: "Online based database dashboard for your PostgreSQL.",
    longDescription: "A comprehensive web-based management tool for PostgreSQL databases. It features real-time query execution, table schema visualization, and data export capabilities designed for developers who need quick access to their data.",
    image: "/api/placeholder/400/300",
    category: "websites",
    tech: ["TypeScript", "React", "Node.js", "PostgreSQL"],
    features: [
      "Real-time SQL query editor with syntax highlighting",
      "Interactive schema explorer and table designer",
      "Data export in multiple formats (CSV, JSON, SQL)",
      "Performance monitoring and query optimization tools"
    ],
    highlights: [
      "Supports large-scale PostgreSQL instances",
      "Optimized for high-concurrency database operations",
      "Secure connection management with encryption"
    ],
    githubUrl: "https://github.com/rajroy1313/Database-web.git",
    status: "Developing",
    statusColor: "bg-red-500",
    timeline: "Ongoing",
    teamSize: "Solo project"
  },
  {
    id: "wh",
    title: "Discord Bot Hosting",
    description: "Professional hosting solution for Discord bots.",
    longDescription: "A dedicated hosting platform optimized for Discord bots, providing 24/7 uptime, automated deployments, and comprehensive monitoring tools to ensure your bot stays online and responsive.",
    image: "/api/placeholder/400/300",
    category: "websites",
    tech: ["React", "TypeScript", "PostgreSQL", "Docker"],
    features: [
      "Automated bot deployment from GitHub repositories",
      "Real-time console logs and performance metrics",
      "DDoS protection and high-availability infrastructure",
      "Easy scaling with one-click resource allocation"
    ],
    highlights: [
      "99.9% uptime guaranteed for hosted bots",
      "Low-latency global infrastructure",
      "Integrated monitoring and alerting system"
    ],
    githubUrl: "https://github.com/rajroy1313/Webhost.git",
    status: "In development",
    statusColor: "bg-red-500",
    timeline: "In development",
    teamSize: "Solo project"
  },
];

export default function ProjectPage() {
  const [match, params] = useRoute("/project/:id");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return <ProjectSkeleton />;
  }

  if (!match || !params?.id) {
    return <div>Project not found</div>;
  }

  const project = projects.find(p => p.id === params.id);
  
  if (!project) {
    return <div>Project not found</div>;
  }

  return <ProjectDetail project={project} />;
}