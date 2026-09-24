import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  Check,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Trash2,
  Unlink,
} from "lucide-react";
import { FaDiscord } from "react-icons/fa";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PasswordInput } from "@/components/ui/password-input";
import { PasswordStrength } from "@/components/password-strength";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { passwordProblem } from "@/lib/password-validation";

/**
 * Client account settings.
 *
 * Three concerns, deliberately separated into cards:
 *
 * - Discord linking. A password account may attach Discord; a Discord account
 *   already has it. Either way the same email can then sign in through Discord.
 * - Password. A Discord-only account is prompted to set one and the prompt stays
 *   until it has; a password account can change its existing one.
 * - Deletion, behind an explicit confirmation.
 *
 * Every password field is validated with the shared rule module, so the meter
 * here and the server's check cannot drift apart.
 */
export default function SettingsPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const {
    user,
    status,
    isAuthenticated,
    refreshAuth,
    changePassword,
    setPassword,
    deleteAccount,
    unlinkDiscord,
    linkDiscord,
    isChangingPassword,
    isDeletingAccount,
  } = useAuth();

  const hasPassword = Boolean(user?.hasPassword);
  const discordLinked = Boolean(user?.discordId);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") setLocation("/login");
  }, [status, setLocation]);

  // The Discord callback lands here with ?discord=linked on success, or an
  // error reason. Report it once and scrub the parameter so a reload is quiet.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("discord");
    if (!result) return;

    if (result === "linked") {
      toast({
        title: "Discord linked",
        description: "You can now sign in with Discord.",
        variant: "success",
      });
      void refreshAuth();
    } else {
      const reasons: Record<string, string> = {
        link_not_authenticated: "Please sign in again before linking Discord.",
        discord_already_linked: "That Discord account is already linked to another user.",
        link_no_account: "That account no longer exists.",
        account_exists_requires_link:
          "An account with this email already exists. Sign in first, then link Discord from settings.",
      };
      toast({
        title: "Discord link failed",
        description: reasons[result] || "Discord did not complete the request.",
        variant: "error",
      });
    }

    window.history.replaceState(null, "", "/settings");
  }, [toast, refreshAuth]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  const onSubmitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (newPassword !== confirmPassword) {
      setFormError("The two passwords do not match.");
      return;
    }
    const problem = passwordProblem(newPassword);
    if (problem) {
      setFormError(problem);
      return;
    }
    if (hasPassword && !currentPassword) {
      setFormError("Enter your current password.");
      return;
    }

    try {
      if (hasPassword) {
        await changePassword({ currentPassword, newPassword });
      } else {
        await setPassword(newPassword);
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({
        title: hasPassword ? "Password changed" : "Password set",
        description: hasPassword
          ? "Your password has been updated."
          : "You can now sign in with your email and password.",
        variant: "success",
      });
    } catch (error: any) {
      setFormError(error.message || "Failed to update password.");
    }
  };

  const onUnlink = async () => {
    try {
      await unlinkDiscord();
      toast({ title: "Discord unlinked", description: "Discord is no longer connected.", variant: "success" });
    } catch (error: any) {
      toast({
        title: "Could not unlink",
        description: error.message || "Please try again.",
        variant: "error",
      });
    }
  };

  const onDelete = async () => {
    try {
      await deleteAccount();
      toast({
        title: "Account deleted",
        description: "Your account and its data have been removed.",
        variant: "success",
      });
      setLocation("/");
    } catch (error: any) {
      toast({
        title: "Could not delete account",
        description: error.message || "Please try again.",
        variant: "error",
      });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage how you sign in and your account.</p>
      </div>

      {/* Discord ------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FaDiscord className="h-5 w-5 text-[#5865F2]" />
            Discord
          </CardTitle>
          <CardDescription>
            Connect Discord to sign in with a single click.
          </CardDescription>
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
              onClick={onUnlink}
              disabled={!hasPassword}
              data-testid="button-unlink-discord"
            >
              <Unlink className="mr-2 h-4 w-4" />
              Unlink Discord
            </Button>
          ) : (
            <Button
              type="button"
              onClick={linkDiscord}
              className="bg-[#5865F2] text-white hover:bg-[#4752c4]"
              data-testid="button-link-discord"
            >
              <Link2 className="mr-2 h-4 w-4" />
              Link Discord
            </Button>
          )}

          {discordLinked && !hasPassword && (
            <p className="text-xs text-muted-foreground">
              Set a password below before unlinking Discord, otherwise you would have
              no way to sign in.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Password ---------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lock className="h-5 w-5 text-primary" />
            {hasPassword ? "Change password" : "Set a password"}
          </CardTitle>
          <CardDescription>
            {hasPassword
              ? "Choose a new password for your account."
              : "Your account was created with Discord. Set a password so you can also sign in with your email address."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmitPassword} className="space-y-4">
            {hasPassword && (
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current password</Label>
                <PasswordInput
                  id="currentPassword"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  data-testid="input-current-password"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <PasswordInput
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                data-testid="input-new-password"
              />
              <PasswordStrength value={newPassword} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <PasswordInput
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                data-testid="input-confirm-password"
              />
            </div>

            {formError && (
              <p className="text-sm text-destructive" data-testid="password-form-error">
                {formError}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={isChangingPassword}
                data-testid="button-save-password"
              >
                {isChangingPassword ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-2 h-4 w-4" />
                    {hasPassword ? "Change password" : "Set password"}
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Danger zone ------------------------------------------------------- */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete account
          </CardTitle>
          <CardDescription>
            Permanently remove your account and all of its data. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isDeletingAccount} data-testid="button-delete-account">
                {isDeletingAccount ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete my account
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes your profile, sign-in details and project
                  requests. It cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-confirm-delete-account"
                >
                  Delete account
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
