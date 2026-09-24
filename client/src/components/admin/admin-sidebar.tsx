import {
  Bot,
  CheckCircle,
  FileEdit,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  Mail,
  PenLine,
  Send,
  Settings,
  ShieldCheck,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useMobileSidebarClose,
} from "@/components/ui/sidebar";
import { AdminThemeToggle } from "@/components/admin/admin-theme-toggle";
import { useMailNotifications } from "@/hooks/useMailNotifications";
import { useAdminAuth } from "@/hooks/useAdminAuth";

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

/** The mailbox views, in the order a mail client presents them. */
const MAIL_VIEWS = [
  { title: "Inbox", view: "inbox", icon: Inbox, badge: "inbox" as const },
  { title: "Starred", view: "starred", icon: Star, badge: "starred" as const },
  { title: "Drafts", view: "drafts", icon: PenLine, badge: "drafts" as const },
  { title: "Sent", view: "sent", icon: Send, badge: null },
  { title: "Trash", view: "trash", icon: Trash2, badge: null },
];

export function AdminSidebar() {
  const [location] = useLocation();
  const searchString = useSearch();

  // Nav links live in the mobile Sheet, so a tap has to close it.
  const closeMobileSidebar = useMobileSidebarClose();

  // Shared notification poll: this is what makes the unread badge update without
  // a full page reload. It returns no counts for a non-owner/admin session.
  const { counts } = useMailNotifications();
  const { canManageBot, canRunTests } = useAdminAuth();
  const onBot = location === "/bot" || location.startsWith("/bot/");
  const onTests = location === "/tests" || location.startsWith("/tests/");

  const onMail = location === "/mail" || location.startsWith("/mail/");
  const activeView = new URLSearchParams(searchString).get("view") || "inbox";

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

        <SidebarGroup className="mt-2">
          <SidebarGroupLabel className="group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={onMail}
                  className={`rounded-lg px-3 py-2 cursor-pointer ${onMail ? "sidebar-nav-active" : ""}`}
                >
                  <Link href="/mail" onClick={closeMobileSidebar}>
                    <span className="truncate flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Mail
                    </span>
                  </Link>
                </SidebarMenuButton>

                {counts && counts.inbox > 0 && (
                  <SidebarMenuBadge aria-label={`${counts.inbox} unread messages`}>
                    {counts.inbox > 99 ? "99+" : counts.inbox}
                  </SidebarMenuBadge>
                )}

                <SidebarMenuSub>
                  {MAIL_VIEWS.map((item) => {
                    const count = item.badge && counts ? counts[item.badge] : 0;
                    const isActive = onMail && activeView === item.view;
                    return (
                      <SidebarMenuSubItem key={item.view}>
                        <SidebarMenuSubButton asChild isActive={isActive} className="cursor-pointer">
                          <Link href={`/mail?view=${item.view}`} onClick={closeMobileSidebar}>
                            <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{item.title}</span>
                            {/* Unread for Inbox, totals for Starred/Drafts. */}
                            {count > 0 && (
                              <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">
                                {count > 99 ? "99+" : count}
                              </span>
                            )}
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    );
                  })}
                </SidebarMenuSub>
              </SidebarMenuItem>

              {/* Owner/admin only, matching the server guard on /api/admin/bot. */}
              {canManageBot && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={onBot}
                    className={`rounded-lg px-3 py-2 cursor-pointer ${onBot ? "sidebar-nav-active" : ""}`}
                  >
                    <Link href="/bot" onClick={closeMobileSidebar}>
                      <span className="truncate flex items-center gap-2">
                        <Bot className="h-4 w-4" />
                        Bot
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {/* Owner only: this page starts a process on the host. */}
              {canRunTests && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={onTests}
                    className={`rounded-lg px-3 py-2 cursor-pointer ${onTests ? "sidebar-nav-active" : ""}`}
                  >
                    <Link href="/tests" onClick={closeMobileSidebar}>
                      <span className="truncate flex items-center gap-2">
                        <FlaskConical className="h-4 w-4" />
                        Tests
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-2 md:p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/settings"}
              className={`rounded-lg px-3 py-2 cursor-pointer ${location === "/settings" ? "sidebar-nav-active" : ""}`}
            >
              <Link href="/settings" onClick={closeMobileSidebar}>
                <span className="group-data-[collapsible=icon]:!hidden md:group-data-[collapsible=icon]:hidden truncate flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex items-center justify-between px-2">
          <AdminThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
