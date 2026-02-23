import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectStatusSelector } from "@/components/project-status-selector";
import { useAuth } from '@/hooks/useAuth';
import { useProjectRequests } from '@/hooks/use-project-requests';

interface Admin {
  id: string;
  pin: string;
  email: string;
  role: string;
  updatedAt: string;
}

type ProjectStatus = 'pending' | 'approved' | 'rejected';

export function AdminPage() {
  const { user } = useAuth();
  const { 
    requests, 
    requestsLoading, 
    updateStatus, 
    updateStatusLoading,
    deleteRequest,
    deleteLoading,
    getStatusCounts
  } = useProjectRequests();
  
  // Role-based permissions
  const canViewStats = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'moderator';
  const canViewUsers = user?.role === 'owner' || user?.role === 'admin';
  const canManageProjects = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'moderator';
  const canManageAdmins = user?.role === 'owner';

  // Fetch users
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await fetch('/api/users');
      if (!response.ok) throw new Error('Failed to fetch users');
      return response.json();
    },
    enabled: canViewUsers,
  });

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

  // Handle status change
  const handleStatusChange = (id: string, newStatus: string) => {
    updateStatus({ id, status: newStatus });
  };

  const statusCounts = getStatusCounts();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-600 mt-2">
              Welcome! Your role: {user?.role.charAt(0).toUpperCase() + user?.role.slice(1)}
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {canViewStats && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalUsers}</div>
              </CardContent>
            </Card>
          )}

          {canViewStats && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Project Requests</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalRequests}</div>
              </CardContent>
            </Card>
          )}

          {canViewStats && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Admin Accounts</CardTitle>
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats?.totalAdmins}</div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {canManageAdmins && (
            <Card>
              <CardHeader>
                <CardTitle>Create New Admin</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="pin">PIN</Label>
                    <Input
                      id="pin"
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value)}
                      placeholder="Enter PIN"
                    />
                  </div>
                  <div>
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter password"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email (Optional)</Label>
                    <Input
                      id="email"
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="Enter email"
                    />
                  </div>
                  <div>
                    <Label htmlFor="role">Role</Label>
                    <select
                      id="role"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                      className="w-full p-2 border rounded-md"
                      disabled={userRole !== "owner"}
                    >
                      <option value="moderator">Moderator</option>
                      {userRole === "owner" && (
                        <>
                          <option value="admin">Admin</option>
                          <option value="owner">Owner</option>
                        </>
                      )}
                    </select>
                    {userRole !== "owner" && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Only owners can assign admin/owner roles
                      </p>
                    )}
                  </div>
                  <Button 
                    onClick={() => createAdminMutation.mutate()}
                    disabled={createAdminMutation.isPending}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Admin
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Admin Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              {adminsLoading ? (
                <div>Loading...</div>
              ) : (
                <div className="space-y-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>PIN</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Last Updated</TableHead>
                        {canDeleteAdmin && <TableHead>Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {admins.map((admin: Admin) => (
                        <TableRow key={admin.id}>
                          <TableCell>{admin.pin}</TableCell>
                          <TableCell>{admin.email || "N/A"}</TableCell>
                          <TableCell>{getRoleBadge(admin.role)}</TableCell>
                          <TableCell>{new Date(admin.updatedAt).toLocaleDateString()}</TableCell>
                          {canDeleteAdmin && (
                            <TableCell>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => deleteAdminMutation.mutate(admin.id)}
                                disabled={deleteAdminMutation.isPending || admin.role === "owner"}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {canViewUsers && (
          <div className="mt-8">
            <Card>
              <CardHeader>
                <CardTitle>User Management</CardTitle>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div>Loading users...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user: any) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            {user.firstName} {user.lastName}
                          </TableCell>
                          <TableCell>{user.email || "N/A"}</TableCell>
                          <TableCell>
                            <Badge variant={user.isBlocked ? "destructive" : "secondary"}>
                              {user.isBlocked ? "Blocked" : "Active"}
                            </Badge>
                          </TableCell>
                          <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {canManageProjects && (
          <div className="mt-8">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <CardTitle>Project Requests</CardTitle>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="secondary">Pending: {statusCounts.pending}</Badge>
                    <Badge variant="default">In Review: {statusCounts.in_review}</Badge>
                    <Badge variant="default">Approved: {statusCounts.approved}</Badge>
                    <Badge variant="destructive">Rejected: {statusCounts.rejected}</Badge>
                    <Badge variant="default">Completed: {statusCounts.completed}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {requestsLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requests.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                            No project requests found
                          </TableCell>
                        </TableRow>
                      ) : (
                        requests.map((request: any) => (
                          <TableRow key={request.id}>
                            <TableCell className="font-medium max-w-[200px] truncate">
                              {request.title}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground">
                                {request.userId.substring(0, 8)}...
                              </span>
                            </TableCell>
                            <TableCell>
                              <ProjectStatusSelector
                                currentStatus={request.status}
                                onStatusChange={(newStatus) => handleStatusChange(request.id, newStatus)}
                                disabled={updateStatusLoading}
                              />
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground">
                                {new Date(request.createdAt).toLocaleDateString()}
                              </span>
                            </TableCell>
                            <TableCell className="text-right space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  // TODO: Implement project details modal/view
                                  alert('Project details view coming soon');
                                }}
                              >
                                View
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => deleteRequest(request.id)}
                                disabled={deleteLoading}
                              >
                                Delete
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                )}
                
                {(updateStatusLoading || deleteLoading) && (
                  <Alert className="mt-4">
                    <AlertDescription>
                      {updateStatusLoading ? 'Updating project status...' : 'Deleting project request...'}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}