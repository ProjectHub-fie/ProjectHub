import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectStatusSelector } from "@/components/project-status-selector";
import { useToast } from '@/hooks/use-toast';

interface DemoProject {
  id: string;
  title: string;
  status: string;
}

export function ProjectStatusDemo() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<DemoProject[]>([
    { id: '1', title: 'Website Redesign Project', status: 'pending' },
    { id: '2', title: 'Mobile App Development', status: 'in_review' },
    { id: '3', title: 'Database Migration', status: 'approved' },
  ]);
  
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleStatusChange = async (id: string, newStatus: string) => {
    setLoadingId(id);
    
    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update local state
      setProjects(prev => 
        prev.map(project => 
          project.id === id 
            ? { ...project, status: newStatus }
            : project
        )
      );
      
      toast({
        title: "Success",
        description: `Project status updated to ${newStatus}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update project status",
        variant: "destructive",
      });
    } finally {
      setLoadingId(null);
    }
  };

  const statusCounts = {
    pending: projects.filter(p => p.status === 'pending').length,
    in_review: projects.filter(p => p.status === 'in_review').length,
    approved: projects.filter(p => p.status === 'approved').length,
    rejected: projects.filter(p => p.status === 'rejected').length,
    completed: projects.filter(p => p.status === 'completed').length,
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle>Project Status Management Demo</CardTitle>
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
          <div className="space-y-4">
            {projects.map((project) => (
              <div key={project.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border rounded-lg">
                <div className="flex-1">
                  <h3 className="font-medium">{project.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    ID: {project.id}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ProjectStatusSelector
                    currentStatus={project.status}
                    onStatusChange={(newStatus) => handleStatusChange(project.id, newStatus)}
                    disabled={loadingId === project.id}
                  />
                  {loadingId === project.id && (
                    <div className="text-sm text-muted-foreground">Updating...</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          <div className="mt-6 p-4 bg-muted rounded-lg">
            <h4 className="font-medium mb-2">How it works:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Click on the status dropdown to change a project's status</li>
              <li>• The system validates the status change and updates the database</li>
              <li>• Real-time feedback is shown with loading states and success messages</li>
              <li>• Status counts update automatically when changes are made</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}