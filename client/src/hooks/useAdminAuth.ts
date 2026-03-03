import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useAdminAuth() {
  const queryClient = useQueryClient();
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch current admin role on mount
  useEffect(() => {
    const fetchAdminRole = async () => {
      try {
        const response = await fetch("/api/admin/current-role");
        if (response.ok) {
          const data = await response.json();
          setAdminRole(data.role || 'moderator');
        } else {
          setAdminRole(null);
        }
      } catch (error) {
        console.error("Failed to fetch admin role:", error);
        setAdminRole(null);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchAdminRole();
  }, []);

  // Check permissions
  const hasPermission = (permission: string): boolean => {
    if (!adminRole) return false;
    
    const PERMISSIONS: Record<string, string[]> = {
      owner: ['create_admin', 'delete_admin', 'manage_moderators', 'manage_projects', 'view_users', 'change_roles'],
      admin: ['create_moderator', 'manage_projects', 'view_users'],
      moderator: ['manage_projects', 'view_users']
    };

    if (adminRole === 'owner') return true;
    return PERMISSIONS[adminRole]?.includes(permission) || false;
  };

  // Role-based checks
  const canViewStats = !!adminRole;
  const canViewUsers = adminRole === 'owner' || adminRole === 'admin' || adminRole === 'moderator';
  const canManageProjects = adminRole === 'owner' || adminRole === 'admin' || adminRole === 'moderator';
  const canDeleteProjects = adminRole === 'owner' || adminRole === 'admin';
  const canManageAdmins = adminRole === 'owner';
  const canCreateAdmins = adminRole === 'owner' || adminRole === 'admin';
  const canDeleteAdmins = adminRole === 'owner';

  return {
    adminRole,
    isLoading,
    isAuthenticated: !!adminRole,
    hasPermission,
    canViewStats,
    canViewUsers,
    canManageProjects,
    canDeleteProjects,
    canManageAdmins,
    canCreateAdmins,
    canDeleteAdmins
  };
}
