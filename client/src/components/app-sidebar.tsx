import { LayoutDashboard, Users, FileEdit, ShieldCheck, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";
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
import { ThemeToggle } from "@/components/ui/theme-toggle";

const items = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Users", url: "/users", icon: Users },
  { title: "Project Requests", url: "/", icon: FileEdit },
  { title: "Add Projects", url: "/verified-projects", icon: CheckCircle },
  { title: "Admin Management", url: "/admin/info", icon: ShieldCheck },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();

  const isActive = (url: string) => location === url;

  return (
    <Sidebar className="border-r data-[state=collapsed]:w-20 data-[state=expanded]:w-64 bg-background">
      <SidebarHeader className="p-4 border-b">
        <div className="flex items-center gap-2 font-bold text-xl text-primary">
          <ShieldCheck className="h-6 w-6" />
          <span className="truncate group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden">Admin Hub</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="py-2">
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden">
            Management
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title} className="mb-1">
                  <SidebarMenuButton
                    onClick={() => setLocation(item.url)}
                    className={`rounded-lg px-3 py-2 cursor-pointer ${isActive(item.url) ? "sidebar-nav-active" : ""}`}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden truncate">
                      {item.title}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-2 md:p-4">
        <div className="flex items-center justify-between px-2">
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
