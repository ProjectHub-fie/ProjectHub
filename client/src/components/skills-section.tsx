import { Monitor, Server, Settings, Rocket } from "lucide-react";
import {
  SiTypescript,
  SiJavascript,
  SiReact,
  SiNodedotjs,
  SiPython,
  SiKotlin,
  SiGo,
  SiPostgresql,
  SiMongodb,
  SiDocker,
  SiVercel,
  SiCloudflare,
  SiDiscord,
} from "react-icons/si";

interface Skill {
  name: string;
  level: number;
}

interface SkillCategory {
  title: string;
  icon: React.ReactNode;
  color: string;
  skills: Skill[];
}

const skillCategories: SkillCategory[] = [
  {
    title: "Frontend",
    icon: <Monitor className="text-4xl" />,
    color: "text-blue-400",
    skills: [
      { name: "React", level: 5 },
      { name: "TypeScript", level: 5 },
      { name: "Tailwind CSS", level: 4 },
      { name: "Vite", level: 4 }
    ]
  },
  {
    title: "Backend",
    icon: <Server className="text-4xl" />,
    color: "text-emerald-400",
    skills: [
      { name: "Node.js", level: 5 },
      { name: "Express", level: 4 },
      { name: "Python", level: 4 },
      { name: "Go", level: 3 }
    ]
  },
  {
    title: "Data & DevOps",
    icon: <Settings className="text-4xl" />,
    color: "text-violet-400",
    skills: [
      { name: "PostgreSQL", level: 5 },
      { name: "MongoDB", level: 4 },
      { name: "Docker", level: 4 },
      { name: "Git", level: 5 }
    ]
  },
  {
    title: "Platforms & Bots",
    icon: <Rocket className="text-4xl" />,
    color: "text-orange-400",
    skills: [
      { name: "Vercel", level: 5 },
      { name: "Cloudflare", level: 4 },
      { name: "discord.js", level: 5 },
      { name: "discord.py", level: 4 }
    ]
  }
];


const techLogos = [
  { name: "TypeScript", icon: SiTypescript, color: "text-blue-400" },
  { name: "JavaScript", icon: SiJavascript, color: "text-yellow-400" },
  { name: "React", icon: SiReact, color: "text-cyan-400" },
  { name: "Node.js", icon: SiNodedotjs, color: "text-emerald-400" },
  { name: "Python", icon: SiPython, color: "text-violet-400" },
  { name: "Kotlin", icon: SiKotlin, color: "text-purple-400" },
  { name: "Go", icon: SiGo, color: "text-sky-400" },
  { name: "PostgreSQL", icon: SiPostgresql, color: "text-blue-300" },
  { name: "MongoDB", icon: SiMongodb, color: "text-green-400" },
  { name: "Docker", icon: SiDocker, color: "text-blue-500" },
  { name: "Vercel", icon: SiVercel, color: "text-slate-300" },
  { name: "Cloudflare", icon: SiCloudflare, color: "text-orange-400" },
  { name: "discord.js", icon: SiDiscord, color: "text-indigo-400" }
];

export default function SkillsSection() {
  const renderSkillDots = (level: number) => {
    return (
      <div className="flex space-x-1">
        {[1, 2, 3, 4, 5].map((dot) => (
          <div
            key={dot}
            className={`w-2 h-2 rounded-full ${
              dot <= level ? "bg-blue-500" : "bg-slate-600"
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <section id="skills" className="py-20 bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500">
              Skills & Technologies
            </span>
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            My technical expertise spans across modern web technologies and development tools
          </p>
        </div>

        {/* Skills Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {skillCategories.map((category, index) => (
            <div
              key={category.title}
              className="bg-card p-8 rounded-2xl border border-border hover:border-primary/50 transition-all duration-300 hover:-translate-y-2"
              data-testid={`skill-category-${index}`}
            >
              <div className={`${category.color} mb-4`}>
                {category.icon}
              </div>
              <h3 className="text-xl font-bold text-foreground mb-4">{category.title}</h3>
              <div className="space-y-3">
                {category.skills.map((skill) => (
                  <div key={skill.name} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{skill.name}</span>
                    {renderSkillDots(skill.level)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Tech Stack Logos */}
        <div className="mt-16 border-t border-border pt-16">
          <h3 className="text-2xl font-bold text-center text-muted-foreground mb-12">
            Technology We Use
          </h3>
          <div className="flex flex-wrap justify-center items-center gap-8 opacity-60 hover:opacity-100 transition-opacity duration-500">
            {techLogos.map((tech) => {
              const Icon = tech.icon;
              return (
                <div
                  key={tech.name}
                  className={`text-4xl ${tech.color} hover:text-opacity-80 transition-colors duration-200`}
                  title={tech.name}
                  data-testid={`tech-logo-${tech.name.toLowerCase()}`}
                >
                  <Icon />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}