import { LayoutDashboard, Users, FileEdit, ShieldCheck, CheckCircle } from "lucide-react";
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
import { AdminThemeToggle } from "@/components/admin/admin-theme-toggle";

/**
 * Navigation for the administration dashboard.
 *
 * hrefs are relative to the dashboard root because AdminApp mounts this tree
 * through wouter's `base` router, which prefixes /pbad automatically.
 */
const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Users", url: "/users", icon: Users },
  { title: "Project Requests", url: "/project-requests", icon: FileEdit },
  { title: "Add Projects", url: "/verified-projects", icon: CheckCircle },
  { title: "Admin Management", url: "/admins", icon: ShieldCheck },
];

export function AdminSidebar() {
  const [location] = useLocation();

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
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-2 md:p-4">
        <div className="flex items-center justify-between px-2">
          <AdminThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}