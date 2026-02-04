import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { 
  Users, 
  FileText, 
  Settings, 
  LogOut, 
  Plus, 
  Trash2, 
  Crown, 
  User, 
  Eye,
  ShieldAlert
} from "lucide-react";

interface Admin {
  id: string;
  pin: string;
  email: string;
  role: string;
  updatedAt: string;
}

export default function AdminPage() {
  const [newPin, setNewPin] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("moderator");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [userRole, setUserRole] = useState<string>("");

  // Get current user role
  useEffect(() => {
    const fetchUserRole = async () => {
      try {
        const res = await apiRequest("/api/admin/stats", "GET");
        if (res.ok) {
          // In a real implementation, you'd get the role from the session
          // For now, we'll simulate this
          setUserRole("owner"); // This would come from session
        }
      } catch (error) {
        console.error("Failed to fetch user role");
      }
    };
    fetchUserRole();
  }, []);

  const { data: admins = [], isLoading: adminsLoading } = useQuery({
    queryKey: ["admins"],
    queryFn: async () => {
      const res = await apiRequest("/api/admin/list", "GET");
      if (!res.ok) throw new Error("Failed to fetch admins");
      return res.json();
    },
  });

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const res = await apiRequest("/api/users", "GET");
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: ["owner", "admin", "moderator"].includes(userRole)
  });

  const { data: requests = [], isLoading: requestsLoading } = useQuery({
    queryKey: ["project-requests"],
    queryFn: async () => {
      const res = await apiRequest("/api/project-requests", "GET");
      if (!res.ok) throw new Error("Failed to fetch requests");
      return res.json();
    },
    enabled: ["owner", "admin", "moderator"].includes(userRole)
  });

  const createAdminMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/admin/create", "POST", {
        pin: newPin,
        password: newPassword,
        email: newEmail,
        role: newRole
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Admin created successfully" });
      queryClient.invalidateQueries({ queryKey: ["admins"] });
      setNewPin("");
      setNewPassword("");
      setNewEmail("");
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to create admin", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const deleteAdminMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(`/api/admin/${id}`, "DELETE");
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      return data;
    },
    onSuccess: () => {
      toast({ title: "Admin deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["admins"] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to delete admin", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/admin/logout", "POST");
      if (!res.ok) throw new Error("Logout failed");
      return res.json();
    },
    onSuccess: () => {
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({ 
        title: "Logout failed", 
        description: error.message,
        variant: "destructive" 
      });
    }
  });

  const canCreateAdmin = ["owner", "admin"].includes(userRole);
  const canDeleteAdmin = ["owner", "admin"].includes(userRole);
  const canViewUsers = ["owner", "admin", "moderator"].includes(userRole);
  const canManageProjects = ["owner", "admin", "moderator"].includes(userRole);

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
              Welcome! Your role: {getRoleBadge(userRole)}
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
          {canViewUsers && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{users.length}</div>
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
                <div className="text-2xl font-bold">{requests.length}</div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Admin Accounts</CardTitle>
              <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{admins.length}</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {canCreateAdmin && (
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
                <CardTitle>Project Requests</CardTitle>
              </CardHeader>
              <CardContent>
                {requestsLoading ? (
                  <div>Loading requests...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requests.map((request: any) => (
                        <TableRow key={request.id}>
                          <TableCell>{request.title}</TableCell>
                          <TableCell>{request.userId}</TableCell>
                          <TableCell>
                            <Badge variant={
                              request.status === 'approved' ? 'default' :
                              request.status === 'rejected' ? 'destructive' :
                              'secondary'
                            }>
                              {request.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{new Date(request.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}