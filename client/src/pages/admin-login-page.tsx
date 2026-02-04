import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Turnstile } from "@marsidev/react-turnstile";

export default function AdminLoginPage() {
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const loginMutation = useMutation({
    mutationFn: async ({ pin, password, captchaToken }: { pin: string; password: string; captchaToken: string | null }) => {
      // Validate CAPTCHA token
      if (!captchaToken) {
        throw new Error("Please complete the security verification");
      }
      
      console.log("Submitting login:", { pin });
      const res = await apiRequest("/api/admin/login", "POST", { pin, password, captchaToken });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Login failed");
      }
      return data;
    },
    onSuccess: () => {
      toast({ title: "Admin access granted" });
      setLocation("/admin");
    },
    onError: (error: Error) => {
      toast({ 
        title: "Login failed", 
        description: error.message,
        variant: "destructive" 
      });
      // Reset CAPTCHA on failure
      setCaptchaToken(null);
    }
  });

  // Use your actual site key
  const siteKey = import.meta.env.CF_TURNSTILE_SITE_KEY || "0x4AAAAAACMs4uviDJ_b45X9";

  // Simple widget reset function
  const resetWidget = () => {
    setCaptchaToken(null);
  };

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
              if (!captchaToken) {
                toast({
                  title: "Security Verification Required",
                  description: "Please complete the CAPTCHA verification",
                  variant: "destructive"
                });
                return;
              }
              loginMutation.mutate({ pin, password, captchaToken });
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
            
            {/* Cloudflare Turnstile Widget - Using your actual keys */}
            <div className="my-6 p-4 border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 flex flex-col items-center">
              <p className="text-sm text-gray-600 mb-3">Security Verification</p>
              <div className="w-full max-w-xs">
                <Turnstile
                  siteKey={siteKey}
                  onSuccess={(token) => {
                    console.log("Turnstile success:", token);
                    setCaptchaToken(token);
                  }}
                  onExpire={() => {
                    console.log("Turnstile expired");
                    setCaptchaToken(null);
                  }}
                  onError={(error) => {
                    console.log("Turnstile error:", error);
                    setCaptchaToken(null);
                  }}
                  options={{
                    theme: "light",
                    appearance: "always",
                    refreshExpired: "manual",
                    retry: "never"
                  }}
                />
              </div>
              {captchaToken && (
                <p className="text-xs text-green-600 mt-2 flex items-center">
                  ✓ Verification completed
                </p>
              )}
            </div>
            
            <Button 
              type="submit" 
              className="w-full"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {captchaToken ? "Access Dashboard" : "Complete Verification First"}
            </Button>
          </form>
          
          <div className="mt-6 text-center">
            <Button 
              onClick={resetWidget}
              variant="outline" 
              size="sm"
              className="text-xs"
            >
              Reset Security Verification
            </Button>
          </div>
          
          <div className="mt-4 text-center text-xs text-muted-foreground">
            <p>Hint: Default PIN is 1234, default password is admin123</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}