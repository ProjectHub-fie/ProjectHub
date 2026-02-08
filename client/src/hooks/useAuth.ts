import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface User {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl?: string | null;
}

const USER_STORAGE_KEY = "projecthub_user";

export function useAuth() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Load user from localStorage on mount
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem(USER_STORAGE_KEY);
      if (storedUser) {
        console.log('Loaded user from localStorage:', JSON.parse(storedUser));
        setUser(JSON.parse(storedUser));
      }
    } catch (error) {
      console.error("Error loading user from localStorage:", error);
      localStorage.removeItem(USER_STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check authentication status with server
  useEffect(() => {
    const checkAuthStatus = async () => {
      console.log('Checking authentication status...');
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
        });

        console.log('Auth check response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('Auth check response data:', data);
          
          if (data.user) {
            setUser(data.user);
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
            console.log('User authenticated and stored locally');
          }
        } else if (response.status === 401) {
          console.log('User not authenticated, clearing local storage');
          // Not authenticated, clear local storage
          setUser(null);
          localStorage.removeItem(USER_STORAGE_KEY);
        } else {
          console.log('Auth check failed with status:', response.status);
        }
      } catch (error) {
        console.error("Error checking auth status:", error);
        // On network error, rely on localStorage state
      } finally {
        setIsCheckingAuth(false);
      }
    };

    if (!isLoading) {
      checkAuthStatus();
    }
  }, [isLoading]);

  const loginMutation = useMutation({
    mutationFn: async (credentials: { email: string; password: string; captchaToken?: string }) => {
      console.log('Attempting login with credentials:', { 
        email: credentials.email,
        hasPassword: !!credentials.password,
        hasCaptcha: !!credentials.captchaToken 
      });
      
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(credentials),
      });

      console.log('Login response status:', response.status);
      
      const data = await response.json();
      console.log('Login response data:', data);

      if (!response.ok) {
        throw new Error(data.message || "Invalid email or password");
      }

      return data;
    },
    onSuccess: (data) => {
      console.log('Login successful, setting user:', data.user);
      if (data && data.user) {
        setUser(data.user);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
        // Invalidate any cached queries that might need refreshing
        queryClient.invalidateQueries({ queryKey: ['auth'] });
      }
    },
    onError: (error) => {
      console.error("Login error:", error);
      // Clear any stale auth data
      setUser(null);
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  });

  const registerMutation = useMutation({
    mutationFn: async (userData: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      captchaToken?: string;
    }) => {
      console.log('Attempting registration with data:', { 
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        hasPassword: !!userData.password,
        hasCaptcha: !!userData.captchaToken 
      });
      
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(userData),
      });

      console.log('Registration response status:', response.status);
      
      const data = await response.json();
      console.log('Registration response data:', data);
      
      if (!response.ok) {
        throw new Error(data.message || "Registration failed");
      }

      return data;
    },
    onSuccess: (data) => {
      console.log('Registration successful, setting user:', data.user);
      if (data && data.user) {
        setUser(data.user);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
        queryClient.invalidateQueries({ queryKey: ['auth'] });
      }
    },
    onError: (error) => {
      console.error("Registration error:", error);
      setUser(null);
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      console.log('Attempting logout...');
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      
      console.log('Logout response status:', response.status);
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Logout failed");
      }
      
      return response.json();
    },
    onSuccess: () => {
      console.log('Logout successful, clearing user data');
      setUser(null);
      localStorage.removeItem(USER_STORAGE_KEY);
      // Clear all cached queries
      queryClient.clear();
      // Redirect to home page
      window.location.href = "/";
    },
    onError: (error) => {
      console.error("Logout error:", error);
      // Even if server logout fails, clear local state
      setUser(null);
      localStorage.removeItem(USER_STORAGE_KEY);
      queryClient.clear();
      window.location.href = "/";
    }
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (userData: {
      firstName?: string;
      lastName?: string;
      profileImageUrl?: string;
    }) => {
      const response = await fetch("/api/auth/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(userData),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to update profile");
      }

      return data;
    },
    onSuccess: (data) => {
      if (data && data.user) {
        setUser(data.user);
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
        queryClient.invalidateQueries({ queryKey: ['auth'] });
      }
    },
  });

  // Manual refresh function
  const refreshAuth = async () => {
    console.log('Manually refreshing auth status...');
    setIsCheckingAuth(true);
    try {
      const response = await fetch("/api/auth/me", {
        credentials: "include",
      });
      
      console.log('Manual auth refresh response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Manual auth refresh data:', data);
        
        if (data.user) {
          setUser(data.user);
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
        }
      } else {
        console.log('Manual auth refresh failed, clearing user data');
        setUser(null);
        localStorage.removeItem(USER_STORAGE_KEY);
      }
    } catch (error) {
      console.error("Error refreshing auth:", error);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  return {
    user,
    isLoading: isLoading || isCheckingAuth,
    isAuthenticated: !!user,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    updateProfile: updateProfileMutation.mutateAsync,
    refreshAuth,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
    isLoggingOut: logoutMutation.isPending,
    isUpdatingProfile: updateProfileMutation.isPending,
  };
}