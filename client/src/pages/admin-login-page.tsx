import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ADMIN_UNAUTHORIZED_PARAM } from "@/lib/admin-routes";

import { useLocation, useSearch } from "wouter";
import { AlertCircle, Crown, Eye, Loader2, ShieldCheck, User } from "lucide-react";

export default function AdminLoginPage() {
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [sessionChecked, setSessionChecked] = useState(false);

  const wasRedirected = new URLSearchParams(searchString).get(ADMIN_UNAUTHORIZED_PARAM) === "1";

  // An administrator with a live session should never see the login form again.
  useEffect(() => {
    let cancelled = false;

    const checkExistingSession = async () => {
      try {
        const res = await fetch("/api/admin/current-role", { credentials: "include" });
        if (!cancelled && res.ok) {
          setLocation("/", { replace: true });
          return;
        }
      } catch (error) {
        console.error("Session check failed:", error);
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    };

    checkExistingSession();
    return () => {
      cancelled = true;
    };
  }, [setLocation]);

  const loginMutation = useMutation({
    mutationFn: async ({ pin, password }: { pin: string; password: string }) => {
      const res = await apiRequest("/api/admin/login", "POST", { pin, password });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Login failed");
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.clear();
      toast({
        title: "Admin access granted",
        description: `Logged in as ${data.role}`,
        variant: "success",
      });
      // Absolute path: wouter's base router already prefixes /pbad for us.
      setLocation("/", { replace: true });
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "error",
      });
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <ShieldCheck className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Admin Portal</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Please enter your PIN and password to continue.
          </p>
        </CardHeader>
        <CardContent>
          {wasRedirected && sessionChecked && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Please sign in to view that administration page.</span>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              loginMutation.mutate({ pin, password });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Enter PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
                required
              />
              <PasswordInput
                placeholder="Enter admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Access Dashboard
            </Button>
          </form>

          <div className="mt-6 p-4 bg-muted rounded-lg">
            <h3 className="text-sm font-medium mb-2">Role Permissions:</h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-yellow-500" />
                <span><strong>Owner:</strong> Full system control</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-blue-500" />
                <span><strong>Admin:</strong> Manage moderators and projects</span>
              </div>
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-green-500" />
                <span><strong>Moderator:</strong> Review projects and users</span>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Credentials are issued by a system owner and are not published here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}