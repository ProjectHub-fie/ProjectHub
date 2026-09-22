import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export interface ProjectInteractionStats {
  likes: number;
  averageRating: number;
  userInteraction: { isLiked: boolean; rating: number | null } | null;
}

const EMPTY_STATS: ProjectInteractionStats = {
  likes: 0,
  averageRating: 0,
  userInteraction: null,
};

/**
 * Likes and ratings for one project.
 *
 * Shared by the project grid, the list page and the detail page so all three
 * agree on the shape of `userInteraction` and on what an anonymous visitor is
 * allowed to do.
 */
export function useProjectInteractions(projectId: string) {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // The signed-in user is part of the key so a login/logout swaps to its own
  // cache entry instead of showing another user's like state.
  const queryKey = ["/api/projects", projectId, "interactions", user?.id ?? "anonymous"];

  const { data = EMPTY_STATS } = useQuery<ProjectInteractionStats>({
    queryKey,
    queryFn: async () => {
      const res = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}/interactions`, "GET");
      return (await res.json()) as ProjectInteractionStats;
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: { isLiked?: boolean; rating?: number }) => {
      const res = await apiRequest(
        `/api/projects/${encodeURIComponent(projectId)}/interactions`,
        "POST",
        data,
      );
      return (await res.json()) as ProjectInteractionStats;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
    },
    onError: (error: any) => {
      toast({
        title: "Action failed",
        description: error.message || "You must be logged in to like or rate projects.",
        variant: "error",
      });
    },
  });

  const requireAuth = (action: string) => {
    if (isAuthenticated && user) return true;
    toast({
      title: "Authentication required",
      description: `You must be logged in to ${action} projects.`,
      variant: "error",
    });
    return false;
  };

  const toggleLike = () => {
    if (!requireAuth("like")) return;
    mutation.mutate({ isLiked: !data.userInteraction?.isLiked });
  };

  const rate = (rating: number) => {
    if (!requireAuth("rate")) return;
    mutation.mutate({ rating });
  };

  return {
    likes: data.likes,
    averageRating: data.averageRating,
    isLiked: Boolean(data.userInteraction?.isLiked),
    rating: data.userInteraction?.rating ?? 0,
    toggleLike,
    rate,
    isPending: mutation.isPending,
  };
}
