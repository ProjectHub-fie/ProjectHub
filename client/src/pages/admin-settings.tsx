import { useEffect, useState } from "react";
import { Check, Link2, Loader2, Unlink } from "lucide-react";
import { FaDiscord } from "react-icons/fa";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

/**
 * Administrator account settings.
 *
 * Only one thing lives here: the Discord link. An administrator signs in with a
 * PIN and password, and linking Discord lets them use the one-click Discord
 * sign-in afterwards. Linking always goes through the OAuth handshake — the
 * client never posts a Discord id — so a forged id cannot attach itself to an
 * admin row.
 */
type AdminMe = {
  id: string;
  pin: string;
  email: string | null;
  role: string;
  discordId: string | null;
};

export default function AdminSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [unlinking, setUnlinking] = useState(false);

  const { data: admin, isLoading } = useQuery<AdminMe>({
    queryKey: ["admin-me"],
    queryFn: async () => {
      const response = await fetch("/api/admin/me", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load your account");
      return response.json();
    },
  });

  // The callback returns to this page with ?discord=linked on success, or a
  // reason. Report it once and scrub the parameter so a reload stays quiet.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("discord");
    if (!result) return;

    if (result === "linked") {
      toast({ title: "Discord linked", description: "You can now sign in with Discord.", variant: "success" });
      void queryClient.invalidateQueries({ queryKey: ["admin-me"] });
    } else {
      const reasons: Record<string, string> = {
        not_configured: "Discord sign-in is not configured on the server.",
        redirect_not_configured: "The Discord callback URL is not configured.",
        link_not_authenticated: "Please sign in again before linking Discord.",
        discord_already_linked: "That Discord account is already linked to another administrator.",
        admin_not_linked: "That Discord account is not linked to any administrator.",
        invalid_state: "The Discord request expired. Please try again.",
        missing_verifier: "The Discord request could not be verified. Please try again.",
      };
      toast({
        title: "Discord link failed",
        description: reasons[result] || "Discord did not complete the request.",
        variant: "error",
      });
    }

    window.history.replaceState(null, "", "/pbad/settings");
  }, [toast, queryClient]);

  const linkDiscord = () => {
    // A full-page navigation: Discord's authorize screen is cross-origin, and
    // the signed state cookie proves which admin initiated the link on return.
    window.location.href = "/api/admin/auth/discord?mode=link";
  };

  const unlinkDiscord = async () => {
    setUnlinking(true);
    try {
      const response = await fetch("/api/admin/auth/discord/link", {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Failed to unlink Discord");
      toast({ title: "Discord unlinked", description: "Discord is no longer connected.", variant: "success" });
      await queryClient.invalidateQueries({ queryKey: ["admin-me"] });
    } catch (error: any) {
      toast({
        title: "Could not unlink",
        description: error.message || "Please try again.",
        variant: "error",
      });
    } finally {
      setUnlinking(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const discordLinked = Boolean(admin?.discordId);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage how you sign in to the admin dashboard.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account</CardTitle>
          <CardDescription>Your administrator identity.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">PIN</span>
            <span className="font-medium">{admin?.pin}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium">{admin?.email || "Not set"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Role</span>
            <Badge variant="secondary">{admin?.role}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FaDiscord className="h-5 w-5 text-[#5865F2]" />
            Discord
          </CardTitle>
          <CardDescription>Connect Discord to sign in to the dashboard with one click.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div className="flex items-center gap-3">
              <FaDiscord className="h-6 w-6 text-[#5865F2]" />
              <div>
                <p className="text-sm font-medium">Discord account</p>
                <p className="text-xs text-muted-foreground">
                  {discordLinked ? "Linked to this account" : "Not linked"}
                </p>
              </div>
            </div>
            {discordLinked ? (
              <Badge variant="secondary" className="gap-1">
                <Check className="h-3 w-3" />
                Linked
              </Badge>
            ) : (
              <Badge variant="outline">Not linked</Badge>
            )}
          </div>

          {discordLinked ? (
            <Button
              type="button"
              variant="outline"
              onClick={unlinkDiscord}
              disabled={unlinking}
              data-testid="admin-unlink-discord"
            >
              {unlinking ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Unlink className="mr-2 h-4 w-4" />
              )}
              Unlink Discord
            </Button>
          ) : (
            <Button
              type="button"
              onClick={linkDiscord}
              className="bg-[#5865F2] text-white hover:bg-[#4752c4]"
              data-testid="admin-link-discord"
            >
              <Link2 className="mr-2 h-4 w-4" />
              Link Discord
            </Button>
          )}

          <p className="text-xs text-muted-foreground">
            Linking is done through Discord's own authorization screen, so a Discord
            account can only be attached by the administrator who controls it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
