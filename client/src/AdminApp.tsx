import React, { lazy, Suspense } from "react";
import { Link, Router, Switch, Route, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminThemeToggle } from "@/components/admin/admin-theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ADMIN_BASE_PATH, ADMIN_UNAUTHORIZED_PARAM } from "@/lib/admin-routes";
import { useAdminAuth } from "@/hooks/useAdminAuth";

const AdminDashboard = lazy(() => import("@/pages/admin-page"));
const AdminUsers = lazy(() => import("@/pages/users-page"));
const AdminProjectRequests = lazy(() => import("@/pages/projects-page"));
const AdminVerifiedProjects = lazy(() => import("@/pages/verified-projects-page"));
const AdminManagement = lazy(() => import("@/pages/admin-info"));
const AdminCreate = lazy(() => import("@/pages/create-admin"));
const AdminLogin = lazy(() => import("@/pages/admin-login-page"));
const AdminMail = lazy(() => import("@/pages/mail-page"));
const AdminSettings = lazy(() => import("@/pages/admin-settings"));
const AdminBot = lazy(() => import("@/pages/admin-bot"));

/**
 * Registers the mail service worker.
 *
 * Called from the mail page rather than at application start, so the public site
 * never installs a worker it does not use. The worker holds no credentials; it
 * only renders push payloads the server has already built.
 */
function registerMailServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/mail-sw.js", { scope: "/" }).catch(() => {
    // Registration can fail in private mode or on an insecure origin; the
    // in-dashboard badge works either way.
  });
}

type AdminPermission = "viewUsers" | "manageProjects" | "manageAdmins" | "mail" | "bot";

function AdminLoading() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <div className="h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AdminAccessDenied() {
  return (
    <div className="p-8">
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            You don't have permission to access this area of the administration dashboard.
          </p>
          <Button asChild variant="outline">
            <Link href="/">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-muted-foreground">This administration page does not exist.</p>
      <Button asChild variant="outline">
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  );
}

/**
 * Client-side gate for dashboard pages.
 *
 * This only improves the experience (it bounces anonymous visitors to the
 * dashboard login) — every /api/admin and /api/users endpoint independently
 * requires an authenticated admin session, so access control does not depend on
 * the URL staying secret or on this component running.
 */
function AdminGuard({ permission, children }: { permission?: AdminPermission; children: React.ReactNode }) {
  const { isLoading, isAuthenticated, canViewUsers, canManageProjects, canManageAdmins, canUseMail, canManageBot } = useAdminAuth();
  const [, setLocation] = useLocation();

  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation(`/login?${ADMIN_UNAUTHORIZED_PARAM}=1`, { replace: true });
    }
  }, [isLoading, isAuthenticated, setLocation]);

  if (isLoading || !isAuthenticated) return <AdminLoading />;

  if (permission === "viewUsers" && !canViewUsers) return <AdminAccessDenied />;
  if (permission === "manageProjects" && !canManageProjects) return <AdminAccessDenied />;
  if (permission === "manageAdmins" && !canManageAdmins) return <AdminAccessDenied />;
  // Mail is owner/admin only. This is the experience layer: every
  // /api/admin/mail route independently enforces the same rule server-side.
  if (permission === "mail" && !canUseMail) return <AdminAccessDenied />;
  // The bot console is owner/admin only, same as mail.
  if (permission === "bot" && !canManageBot) return <AdminAccessDenied />;

  return <>{children}</>;
}

/** Sidebar + header shell shared by every authenticated dashboard page. */
function AdminLayout({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();

  const handleLogout = async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    } catch (error) {
      console.error("Logout error:", error);
    }
    queryClient.clear();
    setLocation("/login");
  };

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "4rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={style}>
      <div className="flex min-h-screen w-full bg-background">
        <AdminSidebar />
        <main className="flex-1 overflow-hidden">
          <div className="p-4 border-b flex items-center justify-between bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <SidebarTrigger data-testid="admin-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleLogout} data-testid="admin-logout">
                Log Out
              </Button>
              <AdminThemeToggle />
            </div>
          </div>
          <div className="overflow-y-auto">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}

/** Wraps a dashboard page in auth/permission checks and the dashboard shell. */
function AdminPage({ permission, children }: { permission?: AdminPermission; children: React.ReactNode }) {
  React.useEffect(() => {
    if (permission === "mail") registerMailServiceWorker();
  }, [permission]);

  return (
    <AdminLayout>
      <AdminGuard permission={permission}>
        <Suspense fallback={<AdminLoading />}>{children}</Suspense>
      </AdminGuard>
    </AdminLayout>
  );
}

/**
 * Administration portal (one deployment, one domain).
 *
 * Everything here is mounted under ADMIN_BASE_PATH via wouter's `base` option,
 * so nested routes stay relative to /pbad and can never render public pages.
 */
export default function AdminApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="projecthub-admin-theme">
        <TooltipProvider>
          <div className="admin-portal">
            <Router base={ADMIN_BASE_PATH}>
              <Suspense fallback={<AdminLoading />}>
                <Switch>
                  <Route path="/login" component={AdminLogin} />
                  <Route path="/">
                    <AdminPage><AdminDashboard /></AdminPage>
                  </Route>
                  <Route path="/users">
                    <AdminPage permission="viewUsers"><AdminUsers /></AdminPage>
                  </Route>
                  <Route path="/project-requests">
                    <AdminPage permission="manageProjects"><AdminProjectRequests /></AdminPage>
                  </Route>
                  <Route path="/verified-projects">
                    <AdminPage permission="manageProjects"><AdminVerifiedProjects /></AdminPage>
                  </Route>
                  <Route path="/admins/create">
                    <AdminPage permission="manageAdmins"><AdminCreate /></AdminPage>
                  </Route>
                  <Route path="/admins">
                    <AdminPage permission="manageAdmins"><AdminManagement /></AdminPage>
                  </Route>
                  <Route path="/mail">
                    <AdminPage permission="mail"><AdminMail /></AdminPage>
                  </Route>
                  <Route path="/bot">
                    <AdminPage permission="bot"><AdminBot /></AdminPage>
                  </Route>
                  <Route path="/settings">
                    <AdminPage><AdminSettings /></AdminPage>
                  </Route>
                  <Route>
                    <AdminPage><AdminNotFound /></AdminPage>
                  </Route>
                </Switch>
              </Suspense>
            </Router>
            <Toaster />
          </div>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}