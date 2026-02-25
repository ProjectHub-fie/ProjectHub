import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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
<<<<<<< HEAD
          const data = await response.json();
          setAdminRole(data.role);
=======
          // If we can access stats, we're authenticated
          // The actual role comes from session
          const roleResponse = await apiRequest("/api/admin/current-role", "GET");
          if (roleResponse.ok) {
            const data = await roleResponse.json();
            setAdminRole(data.role);
          } else {
            // Fallback - check if we can access admin management (owner/admin only)
            try {
              const adminListResponse = await apiRequest("/api/admin/list", "GET");
              if (adminListResponse.ok) {
                setAdminRole('admin'); // Can manage admins but not owner
              } else {
                setAdminRole('moderator'); // Basic permissions only
              }
            } catch {
              setAdminRole('moderator');
            }
          }
        } else {
          setAdminRole(null);
>>>>>>> 8e7d6ff (re)
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

    if (adminRole === 'owner') return true; // Owner has all permissions
    return PERMISSIONS[adminRole as keyof typeof PERMISSIONS]?.includes(permission) || false;
  };

  // Role-based checks - owner has all permissions
  const canViewStats = adminRole === 'owner' || adminRole === 'admin' || adminRole === 'moderator';
  const canViewUsers = adminRole === 'owner' || adminRole === 'admin' || adminRole === 'moderator';
  const canManageProjects = adminRole === 'owner' || adminRole === 'admin' || adminRole === 'moderator';
  const canManageAdmins = adminRole === 'owner'; // Only owner can manage admins
  const canCreateAdmins = adminRole === 'owner' || adminRole === 'admin'; // Owner and admin can create
  const canDeleteAdmins = adminRole === 'owner'; // Only owner can delete admins

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
