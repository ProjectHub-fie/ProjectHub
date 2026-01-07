import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Home, RefreshCw } from "lucide-react";
import { Link } from "wouter";

export default function ErrorPage() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-destructive/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <AlertCircle className="w-6 h-6 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Oops! Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-muted-foreground">
            We encountered an unexpected error. Please try refreshing the page or head back to the home screen.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row gap-3">
          <Button 
            variant="outline" 
            className="w-full gap-2 hover-elevate"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="w-4 h-4" />
            Reload Page
          </Button>
          <Button asChild className="w-full gap-2 hover-elevate">
            <Link href="/">
              <Home className="w-4 h-4" />
              Go Home
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
