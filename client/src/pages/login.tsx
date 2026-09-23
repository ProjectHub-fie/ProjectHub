import { useState, useEffect, useRef } from "react";
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
import { useAuth, SESSION_TOKEN_KEY } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { FaDiscord } from "react-icons/fa";
import { Turnstile } from "@marsidev/react-turnstile";
import { PasswordStrength } from "@/components/password-strength";
import { passwordProblem } from "@/lib/password-validation";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const strongPassword = z
  .string()
  .superRefine((value, ctx) => {
    const problem = passwordProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: strongPassword,
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: strongPassword,
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { login, register, isLoggingIn, isRegistering, isAuthenticated, refreshAuth } = useAuth();
  const [activeTab, setActiveTab] = useState("login");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const turnstileRef = useRef<any>(null);

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  // The server only enforces Turnstile when TURNSTILE_SECRET_KEY is set
  // (verifyTurnstile returns true when it is absent). The client gated submit
  // on `!captchaToken` regardless, so when no site key is configured there is
  // no widget to complete but the buttons stayed disabled and login and
  // registration were both impossible.
  const captchaRequired = Boolean(siteKey);

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

  // Complete the Discord OAuth handshake.
  //
  // The callback now establishes the session itself (an HttpOnly cookie plus,
  // for the SPA, the same signed token a password login issues) and redirects
  // straight to /dashboard. This branch only handles the error redirect and the
  // legacy `?discord=success#token=...` shape, in case a link is cached.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const discordResult = params.get("discord");
    if (!discordResult) return;

    if (discordResult === "success") {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = hash.get("token");

      if (token) {
        localStorage.setItem(SESSION_TOKEN_KEY, token);
        window.history.replaceState(null, "", "/login");
        // Only navigate once the token has actually resolved. Redirecting
        // unconditionally meant an unrecognised token was dropped on
        // /dashboard, which bounced the visitor back to /login with nothing
        // shown - the "no logs, not signed in" symptom.
        refreshAuth().then((resolved) => {
          if (resolved) {
            setLocation("/dashboard");
          } else {
            toast({
              title: "Discord Login Failed",
              description:
                "Discord signed you in, but the session could not be confirmed. Please try again.",
              variant: "error",
            });
          }
        });
        return;
      }

      // No fragment: the session lives in the cookie the callback set, so ask
      // the server who we are instead of declaring failure.
      refreshAuth().then((resolved) => {
        if (resolved) setLocation("/dashboard");
      });
      window.history.replaceState(null, "", "/login");
      return;
    }

    const reason = params.get("reason") || "unknown";
    const discordErrors: Record<string, string> = {
        not_configured: "Discord login is not configured on this deployment.",
        redirect_not_configured:
          "Discord login is not configured correctly: set APP_ORIGIN or DISCORD_CALLBACK_URL to the public https URL.",
        missing_verifier:
          "The Discord sign-in was started in another browser or tab. Please try again from this window.",
        token_exchange:
          "Discord rejected the sign-in. Check that DISCORD_CLIENT_SECRET matches the application and that the callback URL is allow-listed.",
        profile: "Discord did not return your profile. Please try again.",
        missing_code: "Discord did not return an authorization code. Please start again.",
        invalid_state:
          "This sign-in attempt expired or was started elsewhere. Please start again from this window.",
      };
      toast({
        title: "Discord Login Failed",
        description:
          discordErrors[reason] || `Discord did not complete the sign-in (${reason}).`,
        variant: "error",
      });

    window.history.replaceState(null, "", "/login");
  }, [refreshAuth, setLocation, toast]);

  const onLogin = async (values: z.infer<typeof loginSchema>) => {
    if (captchaRequired && !captchaToken) {
      toast({ 
        title: "Captcha Required", 
        description: "Please complete the Turnstile verification.", 
        variant: "error"
      });
      return;
    }
    try {
      const loginResult = await login({ ...values, captchaToken } as any);
      toast({
        title: "Success!",
        description: "You've been logged in successfully.",
        variant: "success",
      });
      
      // Add a small delay to ensure state is properly updated
      setTimeout(() => {
        setLocation("/dashboard");
      }, 100);
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Please check your credentials and try again.",
        variant: "error",
      });
      // Reset captcha on failure
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    }
  };

  const onRegister = async (values: z.infer<typeof registerSchema>) => {
    if (captchaRequired && !captchaToken) {
      toast({ 
        title: "Captcha Required", 
        description: "Please complete the Turnstile verification.", 
        variant: "error"
      });
      return;
    }
    try {
      await register({ ...values, captchaToken } as any);
      toast({
        title: "Welcome!",
        description: "Your account has been created successfully.",
        variant: "success",
      });
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        title: "Registration Failed",
        description: error.message || "Please try again.",
        variant: "error",
      });
      // Reset captcha on failure
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    }
  };

  const onForgotPassword = async (values: z.infer<typeof forgotPasswordSchema>) => {
    if (captchaRequired && !captchaToken) {
      toast({ 
        title: "Captcha Required", 
        description: "Please complete the Turnstile verification.", 
        variant: "error"
      });
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
          variant: "success",
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
        variant: "error",
      });
      // Reset captcha on failure
      setCaptchaToken(null);
      turnstileRef.current?.reset();
    } finally {
      setIsSendingReset(false);
    }
  };

  const onResetPassword = async (values: z.infer<typeof resetPasswordSchema>) => {
    if (captchaRequired && !captchaToken) {
      toast({ 
        title: "Captcha Required", 
        description: "Please complete the Turnstile verification.", 
        variant: "error" 
      });
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
          variant: "success",
        });
        setShowResetPassword(false);
        resetPasswordForm.reset();
      } else {
        const error = await response.json();
        // If token is invalid or expired, redirect to 404 page
        if (error.message && (error.message.toLowerCase().includes('token') || error.message.toLowerCase().includes('expired') || error.message.toLowerCase().includes('invalid'))) {
          setLocation('/404');
          return;
        }
        throw new Error(error.message || "Failed to reset password");
      }
    } catch (error: any) {
      toast({
        title: "Reset Failed",
        description: error.message || "Please try again.",
        variant: "error",
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
          {/* Discord sits above the form so it reads as the primary way in;
              it used to be buried below the tabs under an "Or continue with"
              divider, which made it look like an afterthought. It shares the
              same signed `state` handshake either way. */}
          <Button
            variant="outline"
            className="w-full border-input hover:bg-accent hover:text-accent-foreground flex items-center justify-center gap-2"
            onClick={() => {
              // Discord sign-in runs through Discord's own OAuth screen, so it
              // does not share the form captcha: the signed `state` nonce
              // protects the handshake instead.
              window.location.href = "/api/auth/discord";
            }}
            data-testid="button-discord-login"
          >
            <FaDiscord className="h-4 w-4 text-[#5865F2]" />
            Continue with Discord
          </Button>

          <div className="relative my-4">
            <Separator className="bg-border" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs uppercase tracking-wide text-muted-foreground">
              or
            </span>
          </div>

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
                    {siteKey && <Turnstile
                      ref={turnstileRef}
                      siteKey={siteKey}
                      onSuccess={(token) => setCaptchaToken(token)}
                      onExpire={() => setCaptchaToken(null)}
                      onError={() => setCaptchaToken(null)}
                      options={{
                        theme: "auto",
                        appearance: "always"
                      }}
                    />}
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg- bg-green-500 text-primary-foreground"
                    disabled={isLoggingIn || (captchaRequired && !captchaToken)}
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
                              className="w-full bg-green-600 hover:bg-primary/90 text-primary-foreground"
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
                                  <PasswordStrength value={field.value || ""} />
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
                        <PasswordStrength value={field.value || ""} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-center py-2 min-h-[78px]">
                    {siteKey && <Turnstile                      ref={turnstileRef}                      siteKey={siteKey}
                      onSuccess={(token) => setCaptchaToken(token)}
                      onExpire={() => setCaptchaToken(null)}
                      onError={() => setCaptchaToken(null)}
                      options={{
                        theme: "auto",
                        appearance: "always"
                      }}
                    />}
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={isRegistering || (captchaRequired && !captchaToken)}
                    data-testid="button-register-submit"
                  >
                    {isRegistering ? "Creating Account..." : "Create Account"}
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}