// Seed data for verified projects
const seedProjects = [
  {
    slug: "primebot",
    title: "PrimeBot",
    description: "PrimeBot is a sleek, multipurpose Discord bot built to supercharge your server with essential tools. It features a dynamic giveaway system with customizable entries, interactive polls for instant feedback, and a ticket system for seamless support handling.",
    longDescription: "PrimeBot is a comprehensive Discord bot designed to enhance server functionality with a complete suite of moderation, entertainment, and utility features. Built with performance and reliability in mind, it serves thousands of Discord servers with 99.9% uptime. It features a robust architecture that handles high concurrent users and provides a seamless management experience through its companion dashboard.",
    imageUrl: "/primebot.gif",
    category: "bots",
    technologies: ["discord.js", "Node.js", "PostgreSQL", "Docker", "Redis", "TypeScript", "Express"],
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
    liveUrl: "https://discord.com/oauth2/authorize?client_id=1356575287151951943&permissions=8&integration_type=0&scope=bot%20applications.commands",
    status: "active",
    authorName: "Team ProjectHub",
    architecture: "Multi-sharded microservices architecture with a centralized command handler and persistent PostgreSQL storage.",
    timeline: "6 months development",
    teamSize: "Team ProjectHub",
    userCount: "500+ active users",
    isActive: true,
    sortOrder: 1
  },
  {
    slug: "primebot-dashboard",
    title: "PrimeBot Dashboard",
    description: "Interactive and dynamic website with dashboard of PrimeBot discord bot (Dashboard will come soon)",
    longDescription: "A comprehensive web dashboard for PrimeBot that allows server administrators to configure bot settings, view analytics, manage giveaways, and monitor server activity through an intuitive interface.",
    imageUrl: "/primebot.gif",
    category: "websites",
    technologies: ["TypeScript", "React", "Node.js", "PostgreSQL", "TailwindCSS"],
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
    status: "developing",
    authorName: "Team ProjectHub",
    architecture: "React-based frontend with a Node.js backend using a micro-frontend approach for dashboard modules.",
    timeline: "In development",
    teamSize: "Team ProjectHub",
    isActive: true,
    sortOrder: 2
  },
  {
    slug: "sky-bot",
    title: "Sky Bot",
    description: "Collaborative task management application with real-time updates, team collaboration features, and project tracking capabilities.",
    longDescription: "Sky is a modern task management platform that brings teams together with real-time collaboration, advanced project tracking, and intelligent workflow automation. Designed for productivity and ease of use.",
    imageUrl: "/api/placeholder/400/300",
    category: "bots",
    technologies: ["Discord.js"],
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
    liveUrl: "",
    status: "active",
    authorName: "Raj Roy",
    timeline: "8 months development",
    teamSize: "3 developers",
    userCount: "5,000+ active teams",
    isActive: true,
    sortOrder: 3
  },
  {
    slug: "database-dashboard",
    title: "Database Dashboard",
    description: "Online based database dashboard for your PostgreSQL.",
    longDescription: "A comprehensive web-based management tool for PostgreSQL databases. It features real-time query execution, table schema visualization, and data export capabilities designed for developers who need quick access to their data.",
    imageUrl: "/api/placeholder/400/300",
    category: "websites",
    technologies: ["TypeScript", "React", "Node.js", "PostgreSQL"],
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
    status: "developing",
    authorName: "Raj Roy",
    architecture: "Client-server architecture utilizing direct PostgreSQL connection protocols via secured tunneling for real-time data visualization.",
    timeline: "Ongoing",
    teamSize: "Solo project",
    isActive: true,
    sortOrder: 4
  },
  {
    slug: "webhost",
    title: "Webhost",
    description: "Discord bot hosting platform",
    longDescription: "A dedicated hosting platform optimized for Discord bots, providing 24/7 uptime, automated deployments, and comprehensive monitoring tools to ensure your bot stays online and responsive.",
    imageUrl: "/api/placeholder/400/300",
    category: "websites",
    technologies: ["React", "TypeScript", "PostgreSQL", "Docker"],
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
    status: "developing",
    authorName: "Raj Roy",
    timeline: "In development",
    teamSize: "Solo project",
    isActive: true,
    sortOrder: 5
  }
];

export default seedProjects;