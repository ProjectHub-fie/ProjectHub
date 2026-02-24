import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LogOut, Users, FileText, ShieldAlert, Crown, User, Eye } from "lucide-react";
import { useAuth } from '@/hooks/useAuth';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useToast } from '@/hooks/use-toast';

interface Admin {
  id: string;
  pin: string;
  email: string;
  role: string;
  updatedAt: string;
}

export default function AdminPage() {
  const { user, logout } = useAuth();
  const { 
    adminRole,
    isLoading: isAdminLoading,
    canViewStats,
    canViewUsers,
    canManageProjects,
    canManageAdmins
  } = useAdminAuth();
  const { toast } = useToast();
  
  if (isAdminLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <Skeleton className="h-8 w-8 rounded-full mx-auto mb-2" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // Fetch admin stats
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const response = await fetch('/api/admin/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
    enabled: canViewStats,
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("/api/admin/logout", "POST");
    },
    onSuccess: () => {
      logout();
      toast({ title: "Logged out successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Logout failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  // Role badge component
  const getRoleBadge = (role: string) => {
    const roleStyles = {
      owner: "bg-yellow-100 text-yellow-800 border-yellow-200",
      admin: "bg-blue-100 text-blue-800 border-blue-200",
      moderator: "bg-green-100 text-green-800 border-green-200"
    };
    
    const roleIcons = {
      owner: <Crown className="h-3 w-3" />,
      admin: <User className="h-3 w-3" />,
      moderator: <Eye className="h-3 w-3" />
    };

    return (
      <Badge className={`${roleStyles[role as keyof typeof roleStyles]} flex items-center gap-1`}>
        {roleIcons[role as keyof typeof roleIcons]}
        {role.charAt(0).toUpperCase() + role.slice(1)}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-600 mt-2">
              Welcome! Your role: {getRoleBadge(adminRole || 'guest')}
            </p>
          </div>
          <Button 
            onClick={() => logoutMutation.mutate()} 
            variant="outline"
            disabled={logoutMutation.isPending}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>

        {/* Stats Cards - Only visible to authorized roles */}
        {canViewStats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {canViewUsers && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.totalUsers || 0}</div>
                </CardContent>
              </Card>
            )}

            {canManageProjects && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Project Requests</CardTitle>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.totalRequests || 0}</div>
                </CardContent>
              </Card>
            )}

            {canManageAdmins && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Admin Accounts</CardTitle>
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.totalAdmins || 0}</div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Your Permissions</CardTitle>
                <div className="h-4 w-4 text-muted-foreground">
                  {adminRole === 'owner' ? <Crown className="h-4 w-4 text-yellow-500" /> :
                   adminRole === 'admin' ? <User className="h-4 w-4 text-blue-500" /> :
                   <Eye className="h-4 w-4 text-green-500" />}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Badge variant={canViewUsers ? "default" : "secondary"} className="text-xs">
                    {canViewUsers ? "✓" : "✗"} User Management
                  </Badge>
                  <Badge variant={canManageProjects ? "default" : "secondary"} className="text-xs">
                    {canManageProjects ? "✓" : "✗"} Project Management
                  </Badge>
                  <Badge variant={canManageAdmins ? "default" : "secondary"} className="text-xs">
                    {canManageAdmins ? "✓" : "✗"} Admin Management
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Quick Links Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {canViewUsers && (
            <Card className="hover:shadow-md transition-shadow cursor-pointer" 
                  onClick={() => window.location.href = '/users'}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  User Management
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Manage user accounts, block/unblock users, and view user statistics.
                </p>
                <Button variant="outline" className="mt-4 w-full">
                  Go to User Management
                </Button>
              </CardContent>
            </Card>
          )}

          {canManageProjects && (
            <Card className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => window.location.href = '/projects'}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Project Requests
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Review, approve, reject, and manage project submission requests.
                </p>
                <Button variant="outline" className="mt-4 w-full">
                  Go to Project Management
                </Button>
              </CardContent>
            </Card>
          )}

          {canManageAdmins && (
            <Card className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => window.location.href = '/admin/info'}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5" />
                  Admin Credentials
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Manage administrator accounts, change passwords, and assign roles.
                </p>
                <Button variant="outline" className="mt-4 w-full">
                  Go to Admin Management
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Role-specific quick actions */}
          {adminRole === 'owner' && (
            <Card className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => window.location.href = '/admin/create'}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Create New Admin
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Create new administrator accounts with custom roles and permissions.
                </p>
                <Button variant="outline" className="mt-4 w-full">
                  Create Admin Account
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Empty state for users without permissions */}
        {!canViewStats && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Access Restricted</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                You don't have permission to view dashboard statistics. 
                Please contact your system administrator for access.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}