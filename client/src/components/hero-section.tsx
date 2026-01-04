import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Github, Twitter, Facebook, ChevronDown } from "lucide-react";
import { FaDiscord } from "react-icons/fa";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation } from "wouter";

export default function HeroSection() {
  const [, setLocation] = useLocation();
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const isMobile = useIsMobile();

  const typingTexts = isMobile ? [
    "Building the future one line of code at a time.",
    "React & automation specialist...",
    "Efficient solutions...",
    "Clean code advocate..."
  ] : [
    "Creating efficient solutions for complex problems...",
    "Building the future one line of code at a time...",
    "Specializing in React applications and automation...",
    "Passionate about clean code and user experience..."
  ];

  useEffect(() => {
    const typeText = () => {
      const currentText = typingTexts[currentTextIndex];

      if (isDeleting) {
        setCurrentCharIndex(prev => prev - 1);
      } else {
        setCurrentCharIndex(prev => prev + 1);
      }

      let typeSpeed = isDeleting ? 50 : 100;

      if (!isDeleting && currentCharIndex === currentText.length) {
        typeSpeed = 2000;
        setIsDeleting(true);
      } else if (isDeleting && currentCharIndex === 0) {
        setIsDeleting(false);
        setCurrentTextIndex((prev) => (prev + 1) % typingTexts.length);
      }

      setTimeout(typeText, typeSpeed);
    };

    const timer = setTimeout(typeText, 100);
    return () => clearTimeout(timer);
  }, [currentTextIndex, currentCharIndex, isDeleting, typingTexts]);

  const handleScroll = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <section id="home" className="min-h-screen flex items-center justify-center relative overflow-hidden pt-16 md:pt-20 bg-background text-foreground">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-20 left-4 md:left-10 w-20 h-20 md:w-32 md:h-32 bg-primary/10 rounded-full animate-float"></div>
        <div className="absolute top-32 md:top-40 right-4 md:right-20 w-16 h-16 md:w-24 md:h-24 bg-primary/10 rounded-full animate-float" style={{ animationDelay: "-2s" }}></div>
        <div className="absolute bottom-32 md:bottom-40 left-4 md:left-20 w-24 h-24 md:w-40 md:h-40 bg-primary/10 rounded-full animate-float" style={{ animationDelay: "-4s" }}></div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
        <div className="mb-6 md:mb-8">
          <img 
            src="/Project.jpg" 
            alt="Developer Profile" 
            className="w-32 h-32 md:w-48 md:h-48 rounded-full mx-auto border-4 border-primary/50 shadow-2xl object-cover hover:border-primary transition-all duration-300 hover:scale-105"
            data-testid="profile-image"
          />
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold mb-4 md:mb-6">
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-500">
            ProjectHub
          </span>
        </h1>

        <p className="text-lg md:text-xl lg:text-2xl text-muted-foreground mb-6 md:mb-8 max-w-3xl mx-auto leading-relaxed px-2">
          Full Stack Developer specializing in{" "}
          <span className="text-blue-500 font-medium">Web Applications</span>, 
          <span className="text-violet-500 font-medium"> Automation Bots</span>, and{" "}
          <span className="text-emerald-500 font-medium">Developer Utilities</span>
        </p> 

        {/* Typing Effect */}
        <div className="mb-8 md:mb-12 h-6 md:h-8 px-2">
          <span className="text-sm md:text-lg font-mono text-muted-foreground break-words">
            <span className="text-emerald-500">$</span>{" "}
            <span data-testid="typing-text" className="inline-block">
              {typingTexts[currentTextIndex].substring(0, currentCharIndex)}
            </span>
            <span className="animate-pulse">|</span>
          </span>
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 md:gap-4 justify-center items-center mb-8 md:mb-12 px-4"> &nbsp;
          <Button
            variant="outline"
           
            className="w-full sm:w-auto bg-green-600 text-white px-6 md:px-8 py-3 md:py-4 rounded-xl font-medium hover:bg-green-700 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 text-sm md:text-base min-h-[48px]"

            onClick={() => setLocation("/request-project")}
          >
            Request Your Project
          </Button>
          <Button
            variant="outline"
            onClick={() => handleScroll("projects")}
            className="w-full sm:w-auto bg-blue-600 text-white px-6 md:px-8 py-3 md:py-4 rounded-xl font-medium hover:bg-green-700 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 text-sm md:text-base min-h-[48px]"


            data-testid="button-view-work"
          >
            View our Work
          </Button>
          <Button
            variant="outline"
            onClick={() => handleScroll("contact")}
            className="w-full sm:w-auto bg-violet-600 text-white px-6 md:px-8 py-3 md:py-4 rounded-xl font-medium hover:bg-green-700 hover:shadow-lg transition-all duration-300 hover:-translate-y-1 text-sm md:text-base min-h-[48px]"

            data-testid="button-contact"
          >
            Get In Touch
          </Button>
        </div>

        {/* Social Links */}
        <div className="flex justify-center space-x-4 md:space-x-6">
          <a 
            href="https://github.com/rajroy1313/" 
            className="text-muted-foreground hover:text-primary transition-colors duration-200 text-xl md:text-2xl p-2 hover:bg-secondary rounded-lg" 
            data-testid="social-github"
            aria-label="GitHub Profile"
          >
            <Github />
          </a>
          <a 
            href="https://discord.gg/gd7UNSfX86" 
            className="text-muted-foreground hover:text-primary transition-colors duration-200 text-xl md:text-2xl p-2 hover:bg-secondary rounded-lg" 
            data-testid="social-discord"
            aria-label="Discord Server"
          >
            <FaDiscord />
          </a>
          <a 
            href="#" 
            className="text-muted-foreground hover:text-primary transition-colors duration-200 text-xl md:text-2xl p-2 hover:bg-secondary rounded-lg" 
            data-testid="social-twitter"
            aria-label="Twitter Profile"
          >
            <Twitter />
          </a>
          <a 
            href="https://www.facebook.com/13yv13/" 
            className="text-muted-foreground hover:text-primary transition-colors duration-200 text-xl md:text-2xl p-2 hover:bg-secondary rounded-lg" 
            data-testid="social-facebook"
            aria-label="Facebook Profile"
          >
            <Facebook />
          </a>
        </div>
      </div>

      {/* Scroll Indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce">
        <ChevronDown className="text-muted-foreground text-2xl" />
      </div>
    </section>
  );
}