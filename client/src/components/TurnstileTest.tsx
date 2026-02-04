import { useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { Button } from "@/components/ui/button";

export default function TurnstileTest() {
  const [token, setToken] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || "1x00000000000000000000AA";

  const handleReset = () => {
    setToken(null);
    setIsVisible(false);
    setTimeout(() => setIsVisible(true), 100);
  };

  return (
    <div className="p-4 border rounded-lg max-w-md mx-auto">
      <h3 className="text-lg font-semibold mb-4">Turnstile Test Widget</h3>
      
      {isVisible && (
        <div className="mb-4">
          <Turnstile
            siteKey={siteKey}
            onSuccess={(token) => {
              console.log("Turnstile success:", token);
              setToken(token);
            }}
            onExpire={() => {
              console.log("Turnstile expired");
              setToken(null);
            }}
            onError={(error) => {
              console.log("Turnstile error:", error);
              setToken(null);
            }}
            options={{
              theme: "light",
              appearance: "interaction-only",
              refreshExpired: "manual",
              retry: "never"
            }}
          />
        </div>
      )}
      
      <div className="space-y-2">
        <p className="text-sm">
          Token Status: {token ? "✅ Valid" : "❌ Missing"}
        </p>
        {token && (
          <p className="text-xs text-muted-foreground truncate">
            Token: {token.substring(0, 20)}...
          </p>
        )}
        
        <div className="flex gap-2">
          <Button 
            onClick={handleReset}
            variant="outline"
            size="sm"
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}