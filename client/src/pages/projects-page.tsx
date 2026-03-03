import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ProjectRequest } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, Search, Calendar, Eye, FileText } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { ProjectStatusSelector } from "@/components/project-status-selector";

export default function ProjectsPage() {
  const { canManageProjects, canDeleteProjects } = useAdminAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  
  const { data: projects, isLoading } = useQuery<ProjectRequest[]>({
    queryKey: ["/api/project-requests"],
    enabled: canManageProjects
  });

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    if (!searchTerm) return projects;
    const lowerSearch = searchTerm.toLowerCase();
    return projects.filter(project => 
      project.title.toLowerCase().includes(lowerSearch) || 
      project.description.toLowerCase().includes(lowerSearch) ||
      project.status.toLowerCase().includes(lowerSearch)
    );
  }, [projects, searchTerm]);

  // Status update mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await apiRequest(`/api/projects/${id}/status`, "PUT", { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/project-requests"] });
      toast({ title: "Project status updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating project status",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/projects/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/project-requests"] });
      toast({ title: "Project deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting project",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Handle status change
  const handleStatusChange = (id: string, newStatus: string) => {
    updateStatusMutation.mutate({ id, status: newStatus });
  };

  // Get status counts
  const getStatusCounts = () => {
    if (!projects) return { pending: 0, in_review: 0, approved: 0, rejected: 0, completed: 0 };
    
    return projects.reduce((counts, project) => {
      const status = project.status as string;
      counts[status as keyof typeof counts] = (counts[status as keyof typeof counts] || 0) + 1;
      return counts;
    }, { pending: 0, in_review: 0, approved: 0, rejected: 0, completed: 0 } as Record<string, number>);
  };

  const statusCounts = getStatusCounts();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!canManageProjects) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              You don't have permission to manage projects. Only moderators and administrators can access this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Project Management</h1>
          <p className="text-muted-foreground">
            Review and manage project submission requests
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-projects"
            />
          </div>
        </div>
      </div>

      {/* Status Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{statusCounts.pending}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">In Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{statusCounts.in_review}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{statusCounts.approved}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Rejected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{statusCounts.rejected}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{statusCounts.completed}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredProjects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchTerm ? 'No projects found matching your search.' : 'No project requests found.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjects.map((project) => (
                    <TableRow key={project.id} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <FileText className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <div className="font-medium max-w-[200px] truncate">
                              {project.title}
                            </div>
                            <div className="text-sm text-muted-foreground max-w-[200px] truncate">
                              {project.description}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
                            <span className="text-xs font-medium">
                              {project.userId?.substring(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <span className="text-sm font-mono text-muted-foreground">
                            {project.userId?.substring(0, 8)}...
                          </span>
                        </div>
                      </TableCell>
                      
                      <TableCell>
                        <ProjectStatusSelector
                          currentStatus={project.status}
                          onStatusChange={(newStatus) => handleStatusChange(project.id, newStatus)}
                          disabled={updateStatusMutation.isPending}
                        />
                      </TableCell>
                      
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {project.createdAt ? new Date(project.createdAt).toLocaleDateString() : 'Unknown'}
                          </span>
                        </div>
                      </TableCell>
                      
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              // TODO: Implement project details modal/view
                              alert('Project details view coming soon');
                            }}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                          
                          {canDeleteProjects && (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                if (window.confirm(`Are you sure you want to delete project "${project.title}"? This action cannot be undone.`)) {
                                  deleteMutation.mutate(project.id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {(updateStatusMutation.isPending || deleteMutation.isPending) && (
        <div className="fixed bottom-4 right-4">
          <Card className="p-4 shadow-lg">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">
                {updateStatusMutation.isPending ? 'Updating project status...' : 'Deleting project...'}
              </span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}