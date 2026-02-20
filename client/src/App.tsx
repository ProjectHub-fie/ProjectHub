import React, { useEffect, useState, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/hooks/useAuth";

// 懒加载较重的页面组件
const Home = React.lazy(() => import("@/pages/home"));
const Login = React.lazy(() => import("@/pages/login"));
const Projects = React.lazy(() => import("@/pages/projects"));
const ProjectRequest = React.lazy(() => import("@/pages/project-request"));
const ProjectPage = React.lazy(() => import("@/pages/project"));
const ErrorPage = React.lazy(() => import("@/pages/error"));
const NotFound = React.lazy(() => import("@/pages/not-found"));
const AdminDashboard = React.lazy(() => import("@/pages/admin-dashboard"));
const ResetPassword = React.lazy(() => import("@/pages/reset-password"));

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="hover-elevate"
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

function Router() {
  const { isAuthenticated } = useAuth();
  
  return (
    <Suspense 
      fallback={
        <div className="h-screen w-screen flex items-center justify-center bg-background">
          <div className="h-12 w-12 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/login" component={Login} />
        <Route path="/projects" component={Projects} />
        <Route path="/dashboard" component={ProjectRequest} />
        <Route path="/project/:id" component={ProjectPage} />
        <Route path="/admin" component={() => (
          isAuthenticated ? <AdminDashboard /> : <Login />
        )} />
        <Route path="/error" component={ErrorPage} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  
  if (!mounted) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="h-12 w-12 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="portfolio-theme">
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full overflow-hidden bg-background">
              <AppSidebar className="md:opacity-100 opacity-0 transition-opacity duration-300" />
              <div className="flex flex-col flex-1 overflow-hidden">
                <header className="flex items-center justify-between p-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <SidebarTrigger data-testid="button-sidebar-toggle" className="hover-elevate" />
                  <ThemeToggle />
                </header>
                <main className="flex-1 overflow-y-auto">
                  <Router />
                </main>
              </div>
            </div>
            <Toaster />
          </SidebarProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
