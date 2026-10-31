import { useState } from "react";
import { Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CookingPot, Loader2, Mail, Lock, User, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const getAuthErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) return "Something went wrong. Please try again.";

  if (error.message === "Failed to fetch") {
    return "Unable to reach Supabase. Check that your local Vite env points to a running Supabase project and restart the dev server.";
  }

  return error.message;
};

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  if (user) return <Navigate to="/home" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          toast({ title: "Login failed", description: error.message, variant: "destructive" });
        }
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) {
          toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
        } else {
          setSignUpSuccess(true);
        }
      }
    } catch (error) {
      toast({
        title: isLogin ? "Login failed" : "Sign up failed",
        description: getAuthErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast({ title: "Failed to send reset email", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Reset email sent!", description: "Check your inbox for the password reset link." });
        setIsForgotPassword(false);
      }
    } catch (error) {
      toast({
        title: "Failed to send reset email",
        description: getAuthErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="pt-16 sm:pt-24 pb-12 min-h-screen flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md mx-auto px-6"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full gradient-hero flex items-center justify-center mx-auto mb-4">
            <CookingPot className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="font-heading font-bold text-2xl text-foreground">
            {isForgotPassword ? "Reset Password" : isLogin ? "Welcome Back" : "Join Mamma's Chef"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isForgotPassword
              ? "Enter your email to receive a reset link"
              : isLogin
              ? "Sign in to access your meal plans"
              : "Create an account to start planning"}
          </p>
        </div>

        {signUpSuccess ? (
          <div className="bg-card rounded-lg p-8 shadow-card text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <MailCheck className="w-7 h-7 text-primary" />
            </div>
            <h2 className="font-heading font-bold text-lg text-foreground">Check your email</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We sent a confirmation link to <strong className="text-foreground">{email}</strong>.
              Please click the link to verify your account before signing in.
            </p>
            <p className="text-xs text-muted-foreground">
              Didn't receive it? Check your spam folder.
            </p>
            <Button
              variant="outline"
              onClick={() => { setSignUpSuccess(false); setIsLogin(true); }}
              className="mt-2"
            >
              Back to Sign In
            </Button>
          </div>
        ) : isForgotPassword ? (
          <form onSubmit={handleForgotPassword} className="bg-card rounded-lg p-6 shadow-card space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-10"
                />
              </div>
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full gradient-hero text-primary-foreground border-0 rounded-lg py-5 font-semibold hover:opacity-90 transition-opacity"
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send Reset Link
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <button type="button" onClick={() => setIsForgotPassword(false)} className="text-primary font-medium hover:underline">
                Back to Sign In
              </button>
            </p>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="bg-card rounded-lg p-6 shadow-card space-y-4">
          {!isLogin && (
            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="name"
                  placeholder="Your name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="pl-10"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              {isLogin && (
                <button
                  type="button"
                  onClick={() => setIsForgotPassword(true)}
                  className="text-xs text-primary hover:underline"
                >
                  Forgot Password?
                </button>
              )}
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="pl-10"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full gradient-hero text-primary-foreground border-0 rounded-lg py-5 font-semibold hover:opacity-90 transition-opacity"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            {isLogin ? "Sign In" : "Create Account"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-primary font-medium hover:underline"
            >
              {isLogin ? "Sign Up" : "Sign In"}
            </button>
          </p>
        </form>
        )}
      </motion.div>
    </main>
  );
};

export default Auth;
