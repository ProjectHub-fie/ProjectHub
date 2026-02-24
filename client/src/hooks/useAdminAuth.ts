import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface AdminUser {
  id: string;
  role: string;
}

export function useAdminAuth() {
  const queryClient = useQueryClient();
  const [adminRole, setAdminRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch current admin role on mount
  useEffect(() => {
    const fetchAdminRole = async () => {
      try {
        const response = await apiRequest("/api/admin/stats", "GET");
        if (response.ok) {
          // If we can access stats, we're authenticated
          // The actual role would come from session, but for now we'll determine it
          const roleResponse = await apiRequest("/api/admin/current-role", "GET");
          if (roleResponse.ok) {
            const data = await roleResponse.json();
            setAdminRole(data.role);
          } else {
            // Fallback - determine role based on permissions
            setAdminRole('moderator'); // Default assumption
          }
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
    
    const PERMISSIONS = {
      owner: ['create_admin', 'delete_admin', 'manage_moderators', 'manage_projects', 'view_users', 'change_roles'],
      admin: ['create_moderator', 'manage_projects', 'view_users'],
      moderator: ['manage_projects', 'view_users']
    };

    if (adminRole === 'owner') return true;
    return PERMISSIONS[adminRole as keyof typeof PERMISSIONS]?.includes(permission) || false;
  };

  // Role-based checks
  const canViewStats = hasPermission('view_users');
  const canViewUsers = hasPermission('view_users');
  const canManageProjects = hasPermission('manage_projects');
  const canManageAdmins = adminRole === 'owner';
  const canCreateAdmins = adminRole === 'owner' || adminRole === 'admin';
  const canDeleteAdmins = adminRole === 'owner' || adminRole === 'admin';

  return {
    adminRole,
    isLoading,
    isAuthenticated: !!adminRole,
    hasPermission,
    canViewStats,
    canViewUsers,
    canManageProjects,
    canManageAdmins,
    canCreateAdmins,
    canDeleteAdmins
  };
}