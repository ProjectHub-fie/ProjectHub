import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-lg mx-4">
        <CardContent className="pt-6 text-center">
          <div className="mb-6">
            {/* Simple broken robot graphic using SVG */}
            <svg
              width="120"
              height="120"
              viewBox="0 0 120 120"
              className="mx-auto mb-4 text-gray-400"
              fill="currentColor"
            >
              {/* Robot head */}
              <rect x="40" y="20" width="40" height="30" rx="5" fill="none" stroke="currentColor" strokeWidth="2"/>
              {/* Eyes */}
              <circle cx="50" cy="30" r="3" fill="currentColor"/>
              <circle cx="70" cy="30" r="3" fill="currentColor"/>
              {/* Mouth (broken) */}
              <path d="M50 40 Q60 45 70 40" stroke="currentColor" strokeWidth="2" fill="none"/>
              {/* Body */}
              <rect x="45" y="50" width="30" height="40" rx="3" fill="none" stroke="currentColor" strokeWidth="2"/>
              {/* Arms */}
              <rect x="30" y="55" width="15" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="2"/>
              <rect x="75" y="55" width="15" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="2"/>
              {/* Legs */}
              <rect x="50" y="90" width="6" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="2"/>
              <rect x="64" y="90" width="6" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="2"/>
              {/* Error lines */}
              <path d="M25 25 L35 35" stroke="currentColor" strokeWidth="2"/>
              <path d="M85 25 L95 35" stroke="currentColor" strokeWidth="2"/>
              <path d="M25 75 L35 85" stroke="currentColor" strokeWidth="2"/>
              <path d="M85 75 L95 85" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </div>
          <h1 className="text-6xl font-bold text-gray-900 mb-2">404</h1>
          <h2 className="text-2xl font-semibold text-gray-700 mb-4">That's an error.</h2>
          <p className="text-sm text-gray-600 mb-6">
            The page you requested could not be found. It might have been moved, deleted, or you entered the wrong URL.
          </p>
          <div className="flex justify-center">
            <AlertTriangle className="h-6 w-6 text-yellow-500" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
