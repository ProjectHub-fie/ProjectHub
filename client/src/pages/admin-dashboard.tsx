import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Users, 
  FolderOpen, 
  Clock, 
  Activity, 
  CheckCircle, 
  XCircle,
  Eye,
  Shield
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

interface AdminStats {
  totalUsers: number;
  totalProjects: number;
  pendingRequests: number;
  totalInteractions: number;
  recentActivity: Array<{
    action: string;
    timestamp: string;
    adminName: string;
  }>;
}

interface PendingRequest {
  id: string;
  title: string;
  description: string;
  budget: string;
  timeline: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

export default function AdminDashboard() {
  const { user, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");

  // Check if user is admin
  const isAdmin = user?.adminRole && ['super_admin', 'admin'].includes(user.adminRole);

  // Fetch admin stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => apiRequest<AdminStats>('/api/admin/stats', 'GET'),
    enabled: isAdmin,
  });

  // Fetch pending requests
  const { data: pendingRequests, isLoading: requestsLoading } = useQuery({
    queryKey: ['admin-pending-requests'],
    queryFn: () => apiRequest<{ requests: PendingRequest[] }>('/api/admin/requests/pending', 'GET'),
    enabled: isAdmin,
  });

  // Handle request approval/rejection
  const handleRequestDecision = async (requestId: string, decision: 'approve' | 'reject') => {
    try {
      await apiRequest(`/api/admin/requests/decision`, 'POST', {
        requestId,
        decision,
        reason: decision === 'reject' ? 'Not approved by admin' : undefined
      });
      
      // Refresh data
      window.location.reload();
    } catch (error) {
      console.error('Failed to process request:', error);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Please login to access admin dashboard</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Access denied. Admin privileges required.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Shield className="h-8 w-8 text-emerald-400" />
          <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
          <Badge variant="secondary" className="ml-2">
            {user?.adminRole?.replace('_', ' ').toUpperCase()}
          </Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 bg-slate-800">
            <TabsTrigger value="overview" className="data-[state=active]:bg-emerald-600">
              Overview
            </TabsTrigger>
            <TabsTrigger value="requests" className="data-[state=active]:bg-emerald-600">
              Pending Requests
            </TabsTrigger>
            <TabsTrigger value="activity" className="data-[state=active]:bg-emerald-600">
              Activity Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {statsLoading ? (
              <div className="text-white text-center py-8">Loading statistics...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-slate-400">
                      Total Users
                    </CardTitle>
                    <Users className="h-4 w-4 text-emerald-400" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">{stats?.stats.totalUsers || 0}</div>
                  </CardContent>
                </Card>

                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-slate-400">
                      Projects
                    </CardTitle>
                    <FolderOpen className="h-4 w-4 text-blue-400" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">{stats?.stats.totalProjects || 0}</div>
                  </CardContent>
                </Card>

                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-slate-400">
                      Pending Requests
                    </CardTitle>
                    <Clock className="h-4 w-4 text-yellow-400" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">{stats?.stats.pendingRequests || 0}</div>
                  </CardContent>
                </Card>

                <Card className="bg-slate-800 border-slate-700">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-slate-400">
                      Interactions
                    </CardTitle>
                    <Activity className="h-4 w-4 text-purple-400" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-white">{stats?.stats.totalInteractions || 0}</div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="requests" className="space-y-6">
            {requestsLoading ? (
              <div className="text-white text-center py-8">Loading requests...</div>
            ) : (
              <div className="space-y-4">
                {pendingRequests?.requests?.length === 0 ? (
                  <Card className="bg-slate-800 border-slate-700">
                    <CardContent className="py-8 text-center">
                      <FolderOpen className="h-12 w-12 mx-auto mb-4 text-slate-500" />
                      <p className="text-slate-400">No pending requests</p>
                    </CardContent>
                  </Card>
                ) : (
                  pendingRequests?.requests?.map((request) => (
                    <Card key={request.id} className="bg-slate-800 border-slate-700">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-white">{request.title}</CardTitle>
                            <p className="text-sm text-slate-400 mt-1">
                              Requested by {request.user.firstName} {request.user.lastName} ({request.user.email})
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-green-500 text-green-400 hover:bg-green-500/10"
                              onClick={() => handleRequestDecision(request.id, 'approve')}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-500 text-red-400 hover:bg-red-500/10"
                              onClick={() => handleRequestDecision(request.id, 'reject')}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-slate-300 mb-4">{request.description}</p>
                        <div className="flex flex-wrap gap-4 text-sm text-slate-400">
                          <span>Budget: {request.budget}</span>
                          <span>Timeline: {request.timeline}</span>
                          <span>Requested: {new Date(request.createdAt).toLocaleDateString()}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="activity" className="space-y-6">
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats?.stats.recentActivity?.length === 0 ? (
                  <p className="text-slate-400 text-center py-4">No recent activity</p>
                ) : (
                  <div className="space-y-3">
                    {stats?.stats.recentActivity?.map((activity, index) => (
                      <div key={index} className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0">
                        <div className="flex items-center gap-3">
                          <Eye className="h-4 w-4 text-emerald-400" />
                          <span className="text-slate-300">{activity.action}</span>
                          <span className="text-slate-500 text-sm">by {activity.adminName}</span>
                        </div>
                        <span className="text-slate-500 text-sm">
                          {new Date(activity.timestamp).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}