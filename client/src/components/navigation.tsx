import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Sun, Moon, Menu, X } from "lucide-react";
import { useTheme } from "./theme-provider";

export default function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  const handleScroll = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      setIsOpen(false);
    }
  };

  const NavLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
    <button
      onClick={() => handleScroll(href)}
      className="text-muted-foreground hover bg-white-500:text-primary transition-colors duration-200"
      data-testid={`nav-link-${href}`}
    >
      {children}
    </button>
  );

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-sm border-b border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          {/* Logo */}
          <button
            onClick={() => handleScroll("home")}
            className="text-xl font-bold text-primary"
            data-testid="nav-logo"
          >
            <span className="font-mono">&lt;</span>ProjectHub<span className="font-mono">/&gt;</span>
          </button>

          {/* Desktop Navigation */}
          <div className="hidden md:flex space-x-8">
            <NavLink href="home">Home</NavLink>
            <NavLink href="projects">Projects</NavLink>
            <button
              onClick={() => window.location.href = "/request-project"}
              className="text-muted-foreground hover:text-primary transition-colors duration-200"
              data-testid="nav-link-request-project"
            >
              Request Project
            </button>
            <NavLink href="skills">Skills</NavLink>
            <NavLink href="about">About</NavLink>
            <NavLink href="contact">Contact</NavLink>
          </div>

          <div className="flex items-center space-x-4">
            {/* Theme Toggle */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                const nextTheme = theme === "dark" ? "light" : "dark";
                setTheme(nextTheme);
              }}
              className="hidden md:flex bg-secondary hover:bg-secondary/80 border-border"
              data-testid="theme-toggle"
            >
              <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-yellow-500" />
              <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-primary" />
              <span className="sr-only">Toggle theme</span>
            </Button>

            {/* Mobile Menu */}
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="md:hidden bg-secondary hover:bg-white/80 border-border"
                  data-testid="mobile-menu-trigger"
                >
                  <Menu className="h-4 w-4 text-foreground" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="bg-background border-border">
                <div className="flex flex-col space-y-6 mt-8">
                  <NavLink href="home">Home</NavLink>
                  <NavLink href="projects">Projects</NavLink>
                  <button
                    onClick={() => {
                      window.location.href = "/request-project";
                      setIsOpen(false);
                    }}
                    className="text-muted-foreground hover:text-primary transition-colors duration-200 text-left"
                    data-testid="mobile-nav-link-request-project"
                  >
                    Request Project
                  </button>
                  <NavLink href="skills">Skills</NavLink>
                  <NavLink href="about">About</NavLink>
                  <NavLink href="contact">Contact</NavLink>
                  <div className="px-3 py-2 space-y-2">
                  <Button
                    variant="ghost"
                    onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}
                    className="bg-secondary hover:bg-secondary/80 border-border justify-start w-full"
                    data-testid="mobile-theme-toggle"
                  >
                    {theme === "dark" ? (
                      <>
                        <Sun className="h-4 w-4 text-yellow-500 mr-2" />
                        Switch to Light
                      </>
                    ) : theme === "light" ? (
                      <>
                        <Moon className="h-4 w-4 text-muted-foreground mr-2" />
                        Switch to System
                      </>
                    ) : (
                      <>
                        <Moon className="h-4 w-4 text-primary mr-2" />
                        Switch to Dark
                      </>
                    )}
                  </Button>
                  <div className="text-xs text-muted-foreground px-2">
                    Current: {theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light"}
                  </div>
                </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
}
