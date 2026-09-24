import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ADMIN_UNAUTHORIZED_PARAM } from "@/lib/admin-routes";

import { FaDiscord } from "react-icons/fa";
import { useLocation, useSearch } from "wouter";
import { AlertCircle, Crown, Eye, Loader2, ShieldCheck, User } from "lucide-react";

/** Human-readable reasons the Discord callback can hand back to this page. */
const DISCORD_ERRORS: Record<string, string> = {
  not_configured: "Discord sign-in is not configured on this deployment.",
  redirect_not_configured:
    "Discord sign-in is not configured correctly: set APP_ORIGIN or DISCORD_ADMIN_CALLBACK_URL to the public https URL.",
  admin_not_linked:
    "That Discord account is not linked to an administrator. Sign in with your PIN, then link Discord from settings.",
  link_not_authenticated: "Please sign in again before linking Discord.",
  discord_already_linked: "That Discord account is already linked to another administrator.",
  invalid_state: "The Discord request expired. Please try again.",
  missing_verifier: "The Discord request could not be verified. Please try again.",
  token_exchange: "Discord rejected the sign-in. Check the client secret and callback URL.",
  profile: "Discord did not return your profile. Please try again.",
};

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

  // The Discord callback bounces failures back here as
  // ?discord=error&reason=...; report it once and scrub the query so a reload
  // does not repeat the toast.
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const reason = params.get("reason");
    if (params.get("discord") !== "error" || !reason) return;

    toast({
      title: "Discord Login Failed",
      description: DISCORD_ERRORS[reason] || `Discord did not complete the sign-in (${reason}).`,
      variant: "error",
    });

    const url = new URL(window.location.href);
    url.searchParams.delete("discord");
    url.searchParams.delete("reason");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [searchString, toast]);

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

          {/* Only an administrator whose Discord id is already on their row may
              sign in this way; the callback refuses an unknown Discord account
              rather than claiming an admin row by email. */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full flex items-center justify-center gap-2 border-input"
            onClick={() => {
              window.location.href = "/api/admin/auth/discord";
            }}
            data-testid="admin-button-discord-login"
          >
            <FaDiscord className="h-4 w-4 text-[#5865F2]" />
            Continue with Discord
          </Button>

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