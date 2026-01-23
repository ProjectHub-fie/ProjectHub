import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ProjectsPage from "@/pages/projects-page";
import UsersPage from "@/pages/users-page";
import AdminPage from "@/pages/admin-page";
import AdminInfo from "@/pages/admin-info";
import CreateAdmin from "@/pages/create-admin";
import NotFound from "./pages/not-found";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

function AuthLanding({ onVerified }: { onVerified: () => void }) {
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || !password) return;

    setIsSubmitting(true);
    try {
      console.log("Attempting login to /api/admin/login");
      // Use window.location.origin to ensure we're hitting the right host
      const loginUrl = `${window.location.origin}/api/admin/login`;
      console.log("Full login URL:", loginUrl);
      
      const res = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: pin, password: password }),
        credentials: "include",
      });

      console.log("Login response status:", res.status);
      if (res.ok) {
        const data = await res.json();
        console.log("Login successful, session:", data);
        // Verify session was saved by checking
        await new Promise(resolve => setTimeout(resolve, 500));
        onVerified();
      } else {
        const error = await res.json();
        toast({
          title: "Access Denied",
          description: error.message || "Invalid PIN or password provided.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: "Error",
        description: "Failed to connect to the server.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-background">
      <div className="max-w-md w-full text-center space-y-8 p-8 border rounded-lg bg-card shadow-sm">
        <div className="flex justify-center">
          <div className="p-3 rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">ProjectHub Access</h1>
          <p className="text-muted-foreground text-sm">Enter your Access PIN and Password.</p>
        </div>

        <form onSubmit={handlePinSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-left block">Access PIN</label>
            <Input
              type="text"
              placeholder="Enter PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="text-center text-lg"
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider text-left block">Confirmation Password</label>
            <Input
              type="password"
              placeholder="Enter Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="text-center text-lg"
              required
            />
          </div>
          <Button 
            type="submit"
            size="lg" 
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Verify Access
          </Button>
        </form>
      </div>
    </div>
  );
}

function Router() {
  const [isAdmin, setIsAdmin] = useState(false);

  if (!isAdmin) {
    return <AuthLanding onVerified={() => setIsAdmin(true)} />;
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <main className="flex-1">
          <div className="p-4 border-b flex items-center justify-between">
            <SidebarTrigger />
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setIsAdmin(false)}
              >
                Log Out
              </Button>
            </div>
          </div>
          <Switch>
            <Route path="/" component={ProjectsPage} />
            <Route path="/users" component={UsersPage} />
            <Route path="/admin" component={AdminPage} />
            <Route path="/admin/info" component={AdminInfo} />
            <Route path="/admin/create" component={CreateAdmin} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
