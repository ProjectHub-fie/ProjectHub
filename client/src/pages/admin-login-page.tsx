import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { ShieldCheck, Loader2 } from "lucide-react";

export default function AdminLoginPage() {
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

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
    }
  });

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
          <div className="mt-6 text-center text-xs text-muted-foreground">
            <p>Hint: Default PIN is 1234, default password is admin123</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}