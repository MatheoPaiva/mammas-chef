import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { CookingPot, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });
    const timeout = setTimeout(() => setExpired(true), 10000);
    return () => { subscription.unsubscribe(); clearTimeout(timeout); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast({ title: "Failed to reset password", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password updated!", description: "You can now sign in with your new password." });
      navigate("/planner");
    }
    setLoading(false);
  };

  if (!isRecovery) {
    return (
      <main className="pt-24 pb-12 min-h-screen flex items-center justify-center">
        <div className="text-center px-6">
          {expired ? (
            <>
              <p className="text-muted-foreground mb-4">This reset link is invalid or has expired.</p>
              <Button variant="outline" onClick={() => navigate("/auth")}>Back to Sign In</Button>
            </>
          ) : (
            <>
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">Verifying your reset link…</p>
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="pt-24 pb-12 min-h-screen flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md mx-auto px-6"
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full gradient-hero flex items-center justify-center mx-auto mb-4">
            <CookingPot className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="font-heading font-bold text-2xl text-foreground">Set New Password</h1>
          <p className="text-muted-foreground text-sm mt-1">Enter your new password below.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card rounded-lg p-6 shadow-card space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="new-password"
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

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="confirm-password"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Update Password
          </Button>
        </form>
      </motion.div>
    </main>
  );
};

export default ResetPassword;
