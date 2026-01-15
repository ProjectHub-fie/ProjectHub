import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { FaDiscord } from "react-icons/fa";
import { Turnstile } from "@marsidev/react-turnstile";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Password must be at least 6 characters"),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { login, register, isLoggingIn, isRegistering, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState("login");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  console.log('Turnstile site key status:', !!siteKey);

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      password: "",
      firstName: "",
      lastName: "",
    },
  });

  const forgotPasswordForm = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const resetPasswordForm = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      token: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/dashboard");
    }
  }, [isAuthenticated, setLocation]);

  const onLogin = async (values: z.infer<typeof loginSchema>) => {
    if (!captchaToken) {
      toast({ title: "Captcha Required", description: "Please complete the Turnstile verification.", variant: "destructive" });
      return;
    }
    try {
      await login({ ...values, captchaToken } as any);
      toast({
        title: "Success!",
        description: "You've been logged in successfully.",
      });
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Please check your credentials and try again.",
        variant: "destructive",
      });
    }
  };

  const onRegister = async (values: z.infer<typeof registerSchema>) => {
    if (!captchaToken) {
      toast({ title: "Captcha Required", description: "Please complete the Turnstile verification.", variant: "destructive" });
      return;
    }
    try {
      await register({ ...values, captchaToken } as any);
      toast({
        title: "Welcome!",
        description: "Your account has been created successfully.",
      });
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        title: "Registration Failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const onForgotPassword = async (values: z.infer<typeof forgotPasswordSchema>) => {
    if (!captchaToken) {
      toast({ title: "Captcha Required", description: "Please complete the Turnstile verification.", variant: "destructive" });
      return;
    }
    setIsSendingReset(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, captchaToken }),
      });

      if (response.ok) {
        toast({
          title: "Reset Email Sent!",
          description: "Check your email for password reset instructions.",
        });
        setShowForgotPassword(false);
        forgotPasswordForm.reset();
      } else {
        const error = await response.json();
        throw new Error(error.message || "Failed to send reset email");
      }
    } catch (error: any) {
      toast({
        title: "Reset Failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSendingReset(false);
    }
  };

  const onResetPassword = async (values: z.infer<typeof resetPasswordSchema>) => {
    if (!captchaToken) {
      toast({ title: "Captcha Required", description: "Please complete the Turnstile verification.", variant: "destructive" });
      return;
    }
    setIsResettingPassword(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: values.token,
          newPassword: values.newPassword,
          captchaToken,
        }),
      });

      if (response.ok) {
        toast({
          title: "Password Reset Successfully!",
          description: "You can now login with your new password.",
        });
        setShowResetPassword(false);
        resetPasswordForm.reset();
      } else {
        const error = await response.json();
        throw new Error(error.message || "Failed to reset password");
      }
    } catch (error: any) {
      toast({
        title: "Reset Failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsResettingPassword(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md bg-card border-border">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold text-foreground">Welcome Back</CardTitle>
          <p className="text-muted-foreground">Sign in to request your project</p>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 bg-muted">
              <TabsTrigger value="login" className="data-[state=active]:bg-green-600 data-[state=active]:text-primary-foreground data-[state=inactive]:bg-blue-600">Login</TabsTrigger>
              <TabsTrigger value="register" className="w-full data-[state=active]:bg-green-600 data-[state=active]:text-primary-foreground data-[state=inactive]:bg-blue-600">Register</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="space-y-4">
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                  <FormField
                    control={loginForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground">Email</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            className="bg-background border-input text-foreground"
                            placeholder="your@email.com"
                            data-testid="input-login-email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground">Password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            className="bg-background border-input text-foreground"
                            placeholder="Enter your password"
                            data-testid="input-login-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-center py-2 min-h-[78px]">
                    <Turnstile
                      siteKey={siteKey}
                      onSuccess={(token) => setCaptchaToken(token)}
                      onExpire={() => setCaptchaToken(null)}
                      onError={() => setCaptchaToken(null)}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg- bg-green-500 text-primary-foreground"
                    disabled={isLoggingIn || !captchaToken}
                    data-testid="button-login-submit"
                  >
                    {isLoggingIn ? "Signing In..." : "Sign In"}
                  </Button>
                  
                  <div className="text-center">
                    <Dialog open={showForgotPassword} onOpenChange={setShowForgotPassword}>
                      <DialogTrigger asChild>
                        <Button
                          variant="link"
                          className="text-sm text-muted-foreground hover:text-foreground"
                          data-testid="button-forgot-password"
                        >
                          Forgot your password?
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="bg-card border-border">
                        <DialogHeader>
                          <DialogTitle className="text-foreground">Reset Your Password</DialogTitle>
                        </DialogHeader>
                        <Form {...forgotPasswordForm}>
                          <form onSubmit={forgotPasswordForm.handleSubmit(onForgotPassword)} className="space-y-4">
                            <FormField
                              control={forgotPasswordForm.control}
                              name="email"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-foreground">Email Address</FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="email"
                                      className="bg-background border-input text-foreground"
                                      placeholder="Enter your email address"
                                      data-testid="input-forgot-email"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <Button
                              type="submit"
                              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                              disabled={isSendingReset}
                              data-testid="button-send-reset"
                            >
                              {isSendingReset ? "Sending..." : "Send Reset Email"}
                            </Button>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="text-center">
                    <Dialog open={showResetPassword} onOpenChange={setShowResetPassword}>
                      <DialogTrigger asChild>
                        <Button
                          variant="link"
                          className="text-sm text-muted-foreground hover:text-foreground"
                          data-testid="button-have-reset-token"
                        >
                          Have a reset token?
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="bg-card border-border">
                        <DialogHeader>
                          <DialogTitle className="text-foreground">Enter New Password</DialogTitle>
                        </DialogHeader>
                        <Form {...resetPasswordForm}>
                          <form onSubmit={resetPasswordForm.handleSubmit(onResetPassword)} className="space-y-4">
                            <FormField
                              control={resetPasswordForm.control}
                              name="token"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-foreground">Reset Token</FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      className="bg-background border-input text-foreground"
                                      placeholder="Enter the token from your email"
                                      data-testid="input-reset-token"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={resetPasswordForm.control}
                              name="newPassword"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-foreground">New Password</FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="password"
                                      className="bg-background border-input text-foreground"
                                      placeholder="Enter your new password"
                                      data-testid="input-new-password"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={resetPasswordForm.control}
                              name="confirmPassword"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="text-foreground">Confirm Password</FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      type="password"
                                      className="bg-background border-input text-foreground"
                                      placeholder="Confirm your new password"
                                      data-testid="input-confirm-password"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <Button
                              type="submit"
                              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={isResettingPassword}
                              data-testid="button-reset-password"
                            >
                              {isResettingPassword ? "Resetting..." : "Reset Password"}
                            </Button>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>
                  </div>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="register" className="space-y-4">
              <Form {...registerForm}>
                <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={registerForm.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">First Name</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              className="bg-background border-input text-foreground"
                              placeholder="John"
                              data-testid="input-register-firstname"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Last Name</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              className="bg-background border-input text-foreground"
                              placeholder="Doe"
                              data-testid="input-register-lastname"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={registerForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground">Email</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            className="bg-background border-input text-foreground"
                            placeholder="your@email.com"
                            data-testid="input-register-email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={registerForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground">Password</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            className="bg-background border-input text-foreground"
                            placeholder="Create a password"
                            data-testid="input-register-password"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-center py-2 min-h-[78px]">
                    <Turnstile
                      siteKey={siteKey}
                      onSuccess={(token) => setCaptchaToken(token)}
                      onExpire={() => setCaptchaToken(null)}
                      onError={() => setCaptchaToken(null)}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={isRegistering || !captchaToken}
                    data-testid="button-register-submit"
                  >
                    {isRegistering ? "Creating Account..." : "Create Account"}
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>

          <div className="mt-6">
            <Separator className="bg-border" />
            <p className="text-center text-sm text-muted-foreground my-4">Or continue with</p>

            <Button
              variant="outline"
              className="w-full bg-blue-600 border-input hover:bg-accent hover:text-accent-foreground flex items-center justify-center gap-2"
              onClick={() => {
                if (!captchaToken) {
                  toast({ title: "Captcha Required", description: "Please complete the Turnstile verification before using Discord login.", variant: "destructive" });
                  return;
                }
                window.location.href = `/api/auth/discord?captchaToken=${captchaToken}`;
              }}
              data-testid="button-discord-login"
            >
              <FaDiscord className="h-4 w-4 " />
              Continue with Discord
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}