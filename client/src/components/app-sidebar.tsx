import { Home, Briefcase, FileText, LogIn, LogOut, Moon, Sun } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

/**
 * Navigation for the public client portal.
 *
 * Mirrors the administration sidebar (same shell, spacing, active-item
 * treatment and footer controls) so both portals share one visual language.
 */
const items = [
  { title: "Home", url: "/", icon: Home },
  { title: "Projects", url: "/projects", icon: Briefcase },
  { title: "Dashboard", url: "/dashboard", icon: FileText },
];

function PortalThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
      data-testid="client-theme-toggle"
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-yellow-500" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

export function AppSidebar({ className }: { className?: string }) {
  const [location] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();

  return (
    <Sidebar
      className={`border-r data-[state=collapsed]:w-20 data-[state=expanded]:w-64 bg-background ${className ?? ""}`}
    >
      <SidebarHeader className="p-4 border-b">
        <div className="flex items-center gap-2 font-bold text-xl text-primary">
          <span className="font-mono">&lt;</span>
          <span className="truncate group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden">
            ProjectHub
          </span>
          <span className="font-mono group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden">
            /&gt;
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title} className="mb-1">
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    className={`rounded-lg px-3 py-2 cursor-pointer ${location === item.url ? "sidebar-nav-active" : ""}`}
                  >
                    <Link href={item.url}>
                      <span className="group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden truncate flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        {item.title}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {!isAuthenticated && (
                <SidebarMenuItem className="mb-1">
                  <SidebarMenuButton
                    asChild
                    isActive={location === "/login"}
                    className={`rounded-lg px-3 py-2 cursor-pointer ${location === "/login" ? "sidebar-nav-active" : ""}`}
                  >
                    <Link href="/login">
                      <span className="group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden truncate flex items-center gap-2">
                        <LogIn className="h-4 w-4" />
                        Login
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-2 md:p-4 space-y-3">
        {isAuthenticated && user && (
          <div className="flex items-center gap-3 px-2">
            <Avatar className="h-8 w-8 border border-border">
              <AvatarImage src={user.profileImageUrl || ""} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {user.firstName?.[0]}
                {user.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden">
              <p className="text-sm font-medium text-foreground truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-2">
          <PortalThemeToggle />
          {isAuthenticated && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout()}
              aria-label="Log out"
              data-testid="client-logout"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}