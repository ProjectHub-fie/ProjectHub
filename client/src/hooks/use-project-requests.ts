import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

interface ProjectRequest {
  id: string;
  title: string;
  description: string;
  status: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  budget?: string;
  timeline?: string;
  technologies?: string[];
}

interface UpdateStatusParams {
  id: string;
  status: string;
}

export function useProjectRequests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all project requests
  const { data: requests = [], isLoading: requestsLoading, isError: requestsError } = useQuery<ProjectRequest[]>({
    queryKey: ['project-requests'],
    queryFn: async () => {
      const response = await fetch('/api/project-requests');
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch project requests');
      }
      return response.json();
    },
  });

  // Update project status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: UpdateStatusParams) => {
      const response = await fetch(`/api/projects/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update project status');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['project-requests'] });
      toast({
        title: "Success",
        description: `Project status updated to ${data.status}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update project status",
        variant: "destructive",
      });
    },
  });

  // Delete project request mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete project');
      }
      
      return { id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-requests'] });
      toast({
        title: "Success",
        description: "Project request deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete project request",
        variant: "destructive",
      });
    },
  });

  const updateStatus = (params: UpdateStatusParams) => {
    updateStatusMutation.mutate(params);
  };

  const deleteRequest = (id: string) => {
    if (window.confirm('Are you sure you want to delete this project request?')) {
      deleteMutation.mutate(id);
    }
  };

  return {
    // Data
    requests,
    requestsLoading,
    requestsError,
    
    // Mutations
    updateStatus,
    updateStatusLoading: updateStatusMutation.isPending,
    deleteRequest,
    deleteLoading: deleteMutation.isPending,
    
    // Status helpers
    getStatusCounts: () => {
      const counts = {
        pending: 0,
        in_review: 0,
        approved: 0,
        rejected: 0,
        completed: 0,
      };
      
      requests.forEach(request => {
        if (request.status in counts) {
          counts[request.status as keyof typeof counts]++;
        }
      });
      
      return counts;
    }
  };
}