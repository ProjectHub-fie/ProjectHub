import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/login"],
    enabled: false,
  });

  const meQuery = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    staleTime: Infinity,
  });

  const currentUser = user || meQuery.data;

  const loginMutation = useMutation({
    mutationFn: async (credentials: { email: string; password: string }) => {
      console.log("Attempting login...");
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(credentials),
      });
      
      const data = await response.json();
      console.log("Login response data:", data);
      
      if (!response.ok) {
        throw new Error(data.message || "Invalid email or password");
      }
      
      return data;
    },
    onSuccess: (data) => {
      if (data && data.user) {
        queryClient.setQueryData(["/api/auth/login"], data.user);
        queryClient.setQueryData(["/api/auth/me"], data.user);
      }
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (userData: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
    }) => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(userData),
      });
      
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Registration failed");
      }
      
      return data;
    },
    onSuccess: (data) => {
      if (data && data.user) {
        queryClient.setQueryData(["/api/auth/login"], data.user);
        queryClient.setQueryData(["/api/auth/me"], data.user);
      }
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("/api/auth/logout", "POST");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/login"], null);
      queryClient.setQueryData(["/api/auth/me"], null);
      window.location.href = "/";
    },
  });

  return {
    user: currentUser,
    isLoading: isLoading || meQuery.isLoading,
    isAuthenticated: !!currentUser,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
    isLoggingOut: logoutMutation.isPending,
  };
}