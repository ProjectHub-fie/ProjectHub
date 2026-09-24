import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Camera, Loader2, Mail, Save, User as UserIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { validateEmail } from "@/lib/email-validation";
import { displayName, userInitials } from "@/lib/user-display";

/**
 * Client profile page.
 *
 * One form for the three things a client owns about themselves: their picture,
 * their display name and their email address. The email is validated with the
 * same rule the register form uses (and which both backends enforce), because a
 * profile update must not be a way around the registration check.
 */
export default function ClientProfilePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, status, isAuthenticated, updateProfile, isUpdatingProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Seed the form whenever the resolved user changes, so a reload or a save
  // (which returns the fresh user) fills it back in.
  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
    setEmail(user.email ?? "");
    setEmailError(null);
  }, [user]);

  useEffect(() => {
    if (status === "unauthenticated") setLocation("/login");
  }, [status, setLocation]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  const onPickImage = async (file: File) => {
    // Inlined as a data URL, so the bytes ride inside the JSON body. 2MB is the
    // largest that still clears the deployment's request body cap once base64
    // inflates it by about a third.
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "Image too large",
        description: "Please choose an image under 2MB.",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read that file"));
        reader.readAsDataURL(file);
      });

      await updateProfile({ profileImageUrl: dataUrl });
      toast({ title: "Profile picture updated", variant: "success" });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const check = validateEmail(email);
    if (!check.valid) {
      setEmailError(check.reason ?? "Enter a valid email address");
      return;
    }
    setEmailError(null);

    try {
      await updateProfile({ firstName, lastName, email: check.email });
      toast({
        title: "Profile updated",
        description: "Your details have been saved.",
        variant: "success",
      });
    } catch (error: any) {
      toast({
        title: "Update failed",
        description: error.message || "Please try again.",
        variant: "error",
      });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Update your picture, name and email address.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserIcon className="h-5 w-5 text-primary" />
            Personal details
          </CardTitle>
          <CardDescription>
            This is how you appear across ProjectHub.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-6">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <div className="relative group">
                <Avatar className="h-24 w-24 border-2 border-border">
                  <AvatarImage src={user.profileImageUrl || ""} alt="" />
                  <AvatarFallback className="bg-primary/10 text-2xl text-primary">
                    {userInitials(user)}
                  </AvatarFallback>
                </Avatar>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  aria-label="Change profile picture"
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed"
                  data-testid="button-change-avatar"
                >
                  {isUploading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Camera className="h-6 w-6" />
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onPickImage(file);
                  }}
                  data-testid="input-avatar-file"
                />
              </div>
              <div className="text-center sm:pt-4 sm:text-left">
                <p className="text-sm font-medium">{displayName(user)}</p>
                <p className="text-xs text-muted-foreground">Tap the picture to change it.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  data-testid="input-profile-firstname"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  data-testid="input-profile-lastname"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                required
                data-testid="input-profile-email"
              />
              {emailError ? (
                <p className="text-sm text-destructive" data-testid="profile-email-error">
                  {emailError}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Changing this also changes the address you sign in with.
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={isUpdatingProfile} data-testid="button-save-profile">
                {isUpdatingProfile ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save changes
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
