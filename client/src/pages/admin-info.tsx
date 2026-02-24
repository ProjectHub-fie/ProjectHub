import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, UserPlus, ArrowLeft, KeyRound, Shield, Crown, User, Eye, Calendar } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAdminAuth } from '@/hooks/useAdminAuth';

// Admin Info 页面组件 / Admin Info page component
export default function AdminInfo() {
  const { canManageAdmins } = useAdminAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // 获取管理员列表 / Get admin list
  const { data: admins, isLoading, error } = useQuery<any[]>({
    queryKey: ["/api/admin/list"],
    enabled: canManageAdmins
  });

  // 状态管理用于密码更改功能 / State management for password change functionality
  const [selectedAdmin, setSelectedAdmin] = useState<{id: string, pin: string} | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [currentPin, setCurrentPin] = useState("");

  // 删除管理员的mutation / Delete admin mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/admin/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/list"] });
      toast({ title: "Admin deleted successfully" }); // 管理员删除成功 / Admin deleted successfully
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete admin", // 删除管理员失败 / Failed to delete admin
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // 更改密码的mutation / Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: async ({ id, currentPin, newPassword }: { id: string; currentPin: string; newPassword: string }) => {
      const response = await apiRequest("/api/admin/change-password", "POST", {
        id,
        currentPin,
        newPassword
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/list"] });
      toast({ title: "Password changed successfully" }); // 密码更改成功 / Password changed successfully
      // 重置表单状态 / Reset form state
      setSelectedAdmin(null);
      setNewPassword("");
      setConfirmNewPassword("");
      setCurrentPin("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to change password", // 更改密码失败 / Failed to change password
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // 提交密码更改 / Submit password change
  const handlePasswordChangeSubmit = () => {
    if (!selectedAdmin) return;
    
    // 验证密码匹配 / Verify password match
    if (newPassword !== confirmNewPassword) {
      toast({
        title: "Passwords do not match", // 密码不匹配 / Passwords do not match
        variant: "destructive",
      });
      return;
    }

    // 验证密码长度 / Verify password length
    if (newPassword.length < 6) {
      toast({
        title: "Password too short", // 密码太短 / Password too short
        description: "Password must be at least 6 characters long", // 密码长度至少为6个字符 / Password must be at least 6 characters long
        variant: "destructive",
      });
      return;
    }

    changePasswordMutation.mutate({
      id: selectedAdmin.id,
      currentPin,
      newPassword
    });
  };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
          <span>Loading admins...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive">Error loading admins: {(error as Error).message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!canManageAdmins) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              You don't have permission to manage administrators. Only owners can access this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题和导航 / Page title and navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setLocation("/admin")}
            data-testid="button-back-to-admin"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Admin Management</h1>
            <p className="text-muted-foreground">
              Manage administrator accounts and credentials
            </p>
          </div>
        </div>
        
        <Link href="/admin/create">
          <Button data-testid="button-create-admin">
            <UserPlus className="mr-2 h-4 w-4" />
            Add New Admin
          </Button>
        </Link>
      </div>

      {/* Stats Cards */}
      {canViewAdmins && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Admins</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{admins?.length || 0}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-yellow-600">Owners</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                {admins?.filter(a => a.role === 'owner').length || 0}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-blue-600">Admins</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {admins?.filter(a => a.role === 'admin').length || 0}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-green-600">Moderators</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {admins?.filter(a => a.role === 'moderator').length || 0}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 管理员卡片网格 / Admin card grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(!admins || admins.length === 0) ? (
          <div className="col-span-full">
            <Card>
              <CardContent className="text-center py-10 text-muted-foreground">
                No administrators found.
              </CardContent>
            </Card>
          </div>
        ) : (
          admins.map((admin) => (
            <Card key={admin.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    {admin.role === 'owner' ? <Crown className="h-4 w-4 text-yellow-500" /> :
                     admin.role === 'admin' ? <User className="h-4 w-4 text-blue-500" /> :
                     <Eye className="h-4 w-4 text-green-500" />}
                  </div>
                  <CardTitle className="text-sm font-medium">PIN: {admin.pin}</CardTitle>
                </div>
                
                <div className="flex space-x-1">
                  {/* 密码更改对话框 / Password change dialog */}
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setSelectedAdmin({ id: admin.id, pin: admin.pin })}
                        data-testid={`button-change-password-${admin.id}`}
                      >
                        <KeyRound className="h-4 w-4 text-blue-500" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]">
                      <DialogHeader>
                        <DialogTitle>Change Password</DialogTitle> {/* 更改密码 / Change Password */}
                        <DialogDescription>
                          Enter your current PIN and new password for admin {admin.pin}. {/* 输入当前PIN和新密码 / Enter your current PIN and new password */}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="current-pin" className="text-right">
                            Current PIN {/* 当前PIN / Current PIN */}
                          </Label>
                          <Input
                            id="current-pin"
                            value={currentPin}
                            onChange={(e) => setCurrentPin(e.target.value)}
                            className="col-span-3"
                            type="text"
                            placeholder="Enter current PIN"
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="new-password" className="text-right">
                            New Password {/* 新密码 / New Password */}
                          </Label>
                          <Input
                            id="new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="col-span-3"
                            type="password"
                            placeholder="Enter new password"
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label htmlFor="confirm-password" className="text-right">
                            Confirm Password {/* 确认密码 / Confirm Password */}
                          </Label>
                          <Input
                            id="confirm-password"
                            value={confirmNewPassword}
                            onChange={(e) => setConfirmNewPassword(e.target.value)}
                            className="col-span-3"
                            type="password"
                            placeholder="Confirm new password"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button 
                          type="submit" 
                          onClick={handlePasswordChangeSubmit}
                          disabled={
                            changePasswordMutation.isPending || 
                            !currentPin || 
                            !newPassword || 
                            !confirmNewPassword ||
                            newPassword !== confirmNewPassword
                          }
                        >
                          {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'} {/* 更改中... / Changing... 或 更改密码 / Change Password */}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  
                  {/* 删除按钮 / Delete button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to delete admin with PIN ${admin.pin}? This action cannot be undone.`)) { /* 确定要删除PIN为${admin.pin}的管理员吗？ / Are you sure you want to delete admin with PIN ${admin.pin}? */
                        deleteMutation.mutate(admin.id);
                      }
                    }}
                    disabled={admins.length <= 1 || deleteMutation.isPending || admin.role === "owner"}
                    data-testid={`button-delete-admin-${admin.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Role:</span>
                    {getRoleBadge(admin.role)}
                  </div>
                  
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    Last updated: {admin.updatedAt ? new Date(admin.updatedAt).toLocaleString() : 'Never'} {/* 最后更新时间 / Last updated */}
                  </div>
                  {admin.email && (
                    <div className="text-xs text-muted-foreground truncate">
                      Email: {admin.email}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>


      {(changePasswordMutation.isPending || deleteMutation.isPending) && (
        <div className="fixed bottom-4 right-4">
          <Card className="p-4 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
              <span className="text-sm">
                {changePasswordMutation.isPending ? 'Changing password...' : 'Deleting admin...'}
              </span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}