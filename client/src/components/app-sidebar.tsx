import { Home, Briefcase, FileText, LogIn, LogOut, Moon, Sun, User, Settings } from "lucide-react";
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
  useMobileSidebarClose,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/components/theme-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { displayName, userInitials } from "@/lib/user-display";

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

/**
 * Account pages, shown in the sidebar only while signed in. They live here
 * rather than in `items` so an anonymous visitor never sees links to pages
 * behind a session.
 */
const accountItems = [
  { title: "Profile", url: "/client_profile", icon: User },
  { title: "Settings", url: "/settings", icon: Settings },
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

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAuthenticated, logout } = useAuth();

  // Nav links live in the mobile Sheet, so a tap has to close it.
  const closeMobileSidebar = useMobileSidebarClose();

  return (
    <Sidebar className="border-r data-[state=collapsed]:w-20 data-[state=expanded]:w-64 bg-background">
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
                    <Link href={item.url} onClick={closeMobileSidebar}>
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
                    <Link href="/login" onClick={closeMobileSidebar}>
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

        {isAuthenticated && (
          <SidebarGroup className="mt-2">
            <SidebarGroupLabel className="group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden">
              Account
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {accountItems.map((item) => (
                  <SidebarMenuItem key={item.title} className="mb-1">
                    <SidebarMenuButton
                      asChild
                      isActive={location === item.url}
                      className={`rounded-lg px-3 py-2 cursor-pointer ${location === item.url ? "sidebar-nav-active" : ""}`}
                    >
                      <Link href={item.url} onClick={closeMobileSidebar}>
                        <span className="group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden truncate flex items-center gap-2">
                          <item.icon className="h-4 w-4" />
                          {item.title}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t p-2 md:p-4 space-y-3">
        {isAuthenticated && user && (
          <div className="flex items-center gap-3 px-2" data-testid="client-sidebar-user">
            <Avatar className="h-8 w-8 border border-border">
              <AvatarImage src={user.profileImageUrl || ""} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {userInitials(user)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden">
              <p className="text-sm font-medium text-foreground truncate" data-testid="client-sidebar-name">
                {displayName(user)}
              </p>
              {user.email ? (
                <p className="text-xs text-muted-foreground truncate" data-testid="client-sidebar-email">
                  {user.email}
                </p>
              ) : null}
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