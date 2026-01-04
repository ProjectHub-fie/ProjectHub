import { useEffect, useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import Home from "@/pages/home";
import Login from "@/pages/login";
import ProjectRequest from "@/pages/project-request";
import ProjectPage from "@/pages/project";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/request-project" component={ProjectRequest} />
      <Route path="/project/:id" component={ProjectPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // simulate app boot / initial load
    const timer = setTimeout(() => {
      setLoading(false);
    }, 800); // adjust or remove delay if needed

    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="h-12 w-12 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="portfolio-theme">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
