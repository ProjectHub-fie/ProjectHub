import { Home, LogIn, FileText, User, Mail, Briefcase, Settings } from "lucide-react";
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
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const items = [
  {
    title: "Home",
    url: "/",
    icon: Home,
  },
  {
    title: "Projects",
    url: "/projects",
    icon: Briefcase,
  },
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: FileText,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAuthenticated } = useAuth();

  return (
    <Sidebar className="border-r border-border bg-sidebar">
      <SidebarHeader className="p-4 border-b border-border">
        <div className="flex items-center gap-2 font-bold text-primary text-xl">
          <span className="font-mono">&lt;</span>ProjectHub<span className="font-mono">/&gt;</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/70">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url} 
                    className="hover:bg-primary/10 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
                  >
                    <Link href={item.url}>
                      <div className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </div>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {!isAuthenticated && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/login"} className="hover:bg-primary/10 data-[active=true]:bg-primary data-[active=true]:text-primary-foreground">
                    <Link href="/login" className="flex items-center gap-2">
                      <LogIn className="h-4 w-4" />
                      <span>Login</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {isAuthenticated && user && (
        <SidebarFooter className="p-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8 border border-border">
              <AvatarImage src={user?.profileImageUrl || ""} />
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {(user as any).firstName?.[0]}{(user as any).lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {(user as any).firstName} {(user as any).lastName}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {(user as any).email}
              </p>
            </div>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
