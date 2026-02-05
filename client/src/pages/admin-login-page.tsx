<<<<<<< HEAD
import { useState } from "react";
=======
import { useState, useRef, useEffect } from "react";
>>>>>>> 0b6757d (Add security check to prevent bots from accessing the admin login)
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { ShieldCheck, Loader2, Crown, User, Eye } from "lucide-react";

export default function AdminLoginPage() {
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Add a listener to handle the turnstile challenge
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'cf-turnstile-response') {
        console.log("Turnstile response received");
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const loginMutation = useMutation({
    mutationFn: async ({ pin, password }: { pin: string; password: string }) => {
      console.log("Submitting login:", { pin });
      const res = await apiRequest("/api/admin/login", "POST", { pin, password });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Login failed");
      }
      return data;
    },
    onSuccess: (data) => {
      toast({ 
        title: "Admin access granted",
        description: `Logged in as ${data.role}`
      });
      setLocation("/admin");
    },
    onError: (error: Error) => {
      toast({ 
        title: "Login failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

<<<<<<< HEAD
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="h-4 w-4 text-yellow-500" />;
      case 'admin': return <User className="h-4 w-4 text-blue-500" />;
      case 'moderator': return <Eye className="h-4 w-4 text-green-500" />;
      default: return null;
    }
  };

  const getRoleDescription = (role: string) => {
    switch (role) {
      case 'owner': return 'Full system access - can manage all administrators and settings';
      case 'admin': return 'Can create moderators and manage projects';
      case 'moderator': return 'Can review projects and manage users';
      default: return '';
    }
  };
=======
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
>>>>>>> 0b6757d (Add security check to prevent bots from accessing the admin login)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <ShieldCheck className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">Admin Portal</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Please enter your PIN and password to continue.
          </p>
        </CardHeader>
        <CardContent>
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
                required
              />
              <Input
                type="password"
                placeholder="Enter admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            
<<<<<<< HEAD
=======
            <div className="flex justify-center py-2 min-h-[65px]">
              {siteKey ? (
                <Turnstile
                  ref={turnstileRef}
                  siteKey={siteKey}
                  onSuccess={(token) => setTurnstileToken(token)}
                  onExpire={() => setTurnstileToken(null)}
                  onError={(err) => {
                    console.error("Turnstile error:", err);
                    setTurnstileToken(null);
                  }}
                  options={{
                    theme: 'light',
                    size: 'normal',
                  }}
                />
              ) : (
                <div className="text-destructive text-xs">
                  Turnstile Site Key missing. Please check environment variables.
                </div>
              )}
            </div>

>>>>>>> 0b6757d (Add security check to prevent bots from accessing the admin login)
            <Button 
              type="submit" 
              className="w-full"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Access Dashboard
            </Button>
          </form>
          
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Role Permissions:</h3>
            <div className="space-y-2 text-xs text-gray-600">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-yellow-500" />
                <span><strong>Owner (131313):</strong> Full system control</span>
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
          </div>
          
          <div className="mt-4 text-center text-xs text-muted-foreground">
            <p>Default Owner PIN: 131313, Password: adminpassword</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}