import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { LogOut, Plus, Clock, User, Settings, Camera } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const projectRequestSchema = z.object({
  title: z.string().min(1, "Project title is required"),
  description: z.string().min(10, "Please provide at least 10 characters describing your project"),
  budget: z.string().optional(),
  timeline: z.string().optional(),
  technologies: z.array(z.string()).optional(),
});

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  profileImageUrl: z.string().url("Invalid image URL").or(z.literal("")),
});

export default function ProjectRequestPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isLoading, isAuthenticated, logout, updateProfile, isUpdatingProfile } = useAuth();
  const queryClient = useQueryClient();
  const [showSettings, setShowSettings] = useState(false);

  const form = useForm<z.infer<typeof projectRequestSchema>>({
    resolver: zodResolver(projectRequestSchema),
    defaultValues: {
      title: "",
      description: "",
      budget: "",
      timeline: "",
      technologies: [],
    },
  });

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: (user as any)?.firstName || "",
      lastName: (user as any)?.lastName || "",
      profileImageUrl: (user as any)?.profileImageUrl || "",
    },
  });

  // Update profile form when user data loads
  useEffect(() => {
    if (user) {
      profileForm.reset({
        firstName: (user as any).firstName || "",
        lastName: (user as any).lastName || "",
        profileImageUrl: (user as any).profileImageUrl || "",
      });
    }
  }, [user, profileForm]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation]);

  const { data: userRequests } = useQuery({
    queryKey: ["/api/project-requests"],
    enabled: isAuthenticated && !!user,
  });

  const createRequestMutation = useMutation({
    mutationFn: async (data: z.infer<typeof projectRequestSchema>) => {
      return apiRequest("/api/project-requests", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/project-requests"] });
      form.reset();
      toast({
        title: "Request Submitted!",
        description: "Your project request has been submitted successfully. We'll get back to you soon!",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Submission Failed",
        description: error.message || "Failed to submit project request. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (values: z.infer<typeof projectRequestSchema>) => {
    createRequestMutation.mutate(values);
  };

  const onUpdateProfile = async (values: z.infer<typeof profileSchema>) => {
    try {
      await updateProfile(values);
      toast({
        title: "Profile Updated",
        description: "Your profile information has been updated successfully.",
      });
      setShowSettings(false);
    } catch (error: any) {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect to login
  }

  return (
    <div className="min-h-screen bg-slate-900 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Request Your Project</h1>
            <p className="text-slate-400">Tell us about your dream project and we'll bring it to life!</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3 bg-slate-800 p-2 rounded-full pr-4">
              <Avatar className="h-8 w-8 border border-slate-600">
                <AvatarImage src={(user as any)?.profileImageUrl} alt="Profile" />
                <AvatarFallback className="bg-emerald-500 text-white">
                  {(user as any)?.firstName?.[0]}{(user as any)?.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <span className="text-slate-300 font-medium">{(user as any)?.firstName} {(user as any)?.lastName}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowSettings(!showSettings)}
                className={`bg-slate-800 border-slate-600 hover:bg-slate-700 ${showSettings ? 'text-emerald-400 border-emerald-500/50' : ''}`}
                data-testid="button-settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                onClick={() => logout()}
                className="bg-slate-800 border-slate-600 hover:bg-slate-700"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Logout</span>
              </Button>
            </div>
          </div>
        </div>

        {showSettings && (
          <Card className="mb-8 bg-slate-800 border-slate-700 overflow-hidden animate-in slide-in-from-top duration-300">
            <CardHeader className="bg-slate-800/50 border-b border-slate-700">
              <CardTitle className="text-white flex items-center gap-2">
                <User className="h-5 w-5 text-emerald-400" />
                Profile Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <Form {...profileForm}>
                <form onSubmit={profileForm.handleSubmit(onUpdateProfile)} className="space-y-6">
                  <div className="flex flex-col md:flex-row gap-8">
                    <div className="flex flex-col items-center gap-4">
                      <div className="relative group">
                        <Avatar className="h-24 w-24 border-2 border-emerald-500/20">
                          <AvatarImage src={profileForm.watch("profileImageUrl")} />
                          <AvatarFallback className="bg-slate-700 text-2xl">
                            {(user as any)?.firstName?.[0]}{(user as any)?.lastName?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-full">
                          <Camera className="h-6 w-6 text-white" />
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const formData = new FormData();
                                formData.append('file', file);
                                try {
                                  const response = await fetch('/api/auth/upload-profile-pic', {
                                    method: 'POST',
                                    body: formData,
                                  });
                                  const data = await response.json();
                                  if (response.ok) {
                                    profileForm.setValue('profileImageUrl', data.user.profileImageUrl);
                                    toast({ title: "Image uploaded!" });
                                  }
                                } catch (err) {
                                  toast({ title: "Upload failed", variant: "destructive" });
                                }
                              }
                            }}
                          />
                        </label>
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-1">
                        Tap image to upload
                      </div>
                    </div>
                      <div className="flex-1 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField
                            control={profileForm.control}
                            name="firstName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-slate-300">First Name</FormLabel>
                                <FormControl>
                                  <Input 
                                    {...field} 
                                    className="bg-slate-700 border-slate-600 text-white" 
                                    onChange={(e) => {
                                      field.onChange(e);
                                      const currentValues = profileForm.getValues();
                                      updateProfile({ ...currentValues, firstName: e.target.value });
                                    }}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={profileForm.control}
                            name="lastName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-slate-300">Last Name</FormLabel>
                                <FormControl>
                                  <Input 
                                    {...field} 
                                    className="bg-slate-700 border-slate-600 text-white" 
                                    onChange={(e) => {
                                      field.onChange(e);
                                      const currentValues = profileForm.getValues();
                                      updateProfile({ ...currentValues, lastName: e.target.value });
                                    }}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                        <FormField
                          control={profileForm.control}
                          name="profileImageUrl"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-slate-300">Profile Image URL</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="https://..." 
                                  className="bg-slate-700 border-slate-600 text-white" 
                                  onChange={(e) => {
                                    field.onChange(e);
                                    const currentValues = profileForm.getValues();
                                    updateProfile({ ...currentValues, profileImageUrl: e.target.value });
                                  }}
                                />
                              </FormControl>
                              <FormDescription className="text-slate-500">Paste a link to your avatar image</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      <div className="flex justify-end gap-3 pt-2">
                        <Button 
                          type="button" 
                          variant="ghost" 
                          onClick={() => setShowSettings(false)}
                          className="text-slate-400 hover:text-white"
                        >
                          Cancel
                        </Button>
                        <Button 
                          type="submit" 
                          disabled={isUpdatingProfile}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[120px]"
                        >
                          {isUpdatingProfile ? "Saving..." : "Save Changes"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Project Request Form */}
          <Card className="lg:col-span-2 bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Plus className="h-5 w-5" />
                New Project Request
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">Project Title</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="bg-slate-700 border-slate-600 text-white"
                            placeholder="e.g., E-commerce website, Mobile app, etc."
                            data-testid="input-project-title"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-300">Project Description</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            className="bg-slate-700 border-slate-600 text-white min-h-32"
                            placeholder="Describe your project in detail. What features do you need? What problem does it solve?"
                            data-testid="textarea-project-description"
                          />
                        </FormControl>
                        <FormDescription className="text-slate-400">
                          The more details you provide, the better we can understand your needs.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="budget"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-300">Budget Range</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="bg-slate-700 border-slate-600 text-white" data-testid="select-budget">
                                <SelectValue placeholder="Select budget range" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-slate-700 border-slate-600">
                              <SelectItem value="under-1k">Under $1,000</SelectItem>
                              <SelectItem value="1k-5k">$1,000 - $5,000</SelectItem>
                              <SelectItem value="5k-10k">$5,000 - $10,000</SelectItem>
                              <SelectItem value="10k-25k">$10,000 - $25,000</SelectItem>
                              <SelectItem value="25k-plus">$25,000+</SelectItem>
                              <SelectItem value="discuss">Let's discuss</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="timeline"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-slate-300">Timeline</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="bg-slate-700 border-slate-600 text-white" data-testid="select-timeline">
                                <SelectValue placeholder="Select timeline" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-slate-700 border-slate-600">
                              <SelectItem value="asap">ASAP</SelectItem>
                              <SelectItem value="1-2-weeks">1-2 weeks</SelectItem>
                              <SelectItem value="1-month">1 month</SelectItem>
                              <SelectItem value="2-3-months">2-3 months</SelectItem>
                              <SelectItem value="3-6-months">3-6 months</SelectItem>
                              <SelectItem value="flexible">Flexible</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600"
                    disabled={createRequestMutation.isPending}
                    data-testid="button-submit-request"
                  >
                    {createRequestMutation.isPending ? "Submitting..." : "Submit Project Request"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* Previous Requests */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Your Requests
              </CardTitle>
            </CardHeader>
            <CardContent>
              {userRequests && Array.isArray(userRequests) && userRequests.length > 0 ? (
                <div className="space-y-4">
                  {Array.isArray(userRequests) && userRequests.map((request: any) => (
                    <div key={request.id} className="p-4 bg-slate-700 rounded-lg">
                      <h4 className="font-medium text-white mb-2" data-testid={`request-title-${request.id}`}>{request.title}</h4>
                      <p className="text-sm text-slate-400 mb-2 line-clamp-2" data-testid={`request-description-${request.id}`}>
                        {request.description}
                      </p>
                      <div className="flex items-center justify-between">
                        <Badge
                          variant={request.status === 'pending' ? 'secondary' : 'default'}
                          className="text-xs"
                          data-testid={`request-status-${request.id}`}
                        >
                          {request.status}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {new Date(request.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-slate-400 py-8">
                  <Plus className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No project requests yet.</p>
                  <p className="text-sm">Submit your first request!</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}