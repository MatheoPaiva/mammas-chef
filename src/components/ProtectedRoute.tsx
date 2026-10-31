import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const ProtectedRoute = ({ children }: { children?: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(true);

  // Fetch onboarding status when the signed-in user changes. Keep this gate
  // mounted across protected pages so moving between pages (e.g. /planner?plan=…) does not
  // remount, refetch, fail closed, and bounce onboarded users to /home.
  useEffect(() => {
    if (!user) {
      setOnboardingComplete(null);
      setCheckingProfile(false);
      return;
    }

    if (onboardingComplete === true && location.pathname !== "/onboarding") {
      setCheckingProfile(false);
      return;
    }

    setCheckingProfile(true);
    let cancelled = false;

    const fetchProfile = async (retries = 2): Promise<void> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("onboarding_complete")
        .eq("id", user.id)
        .single();

      if (cancelled) return;

      if (error) {
        console.error("Failed to check onboarding status:", error.message);
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 500));
          if (cancelled) return;
          return fetchProfile(retries - 1);
        }
        // Fail open for a signed-in user: a profile blip should not send
        // returning users through /onboarding → /home.
        setOnboardingComplete(true);
      } else {
        setOnboardingComplete(data?.onboarding_complete ?? false);
      }
      setCheckingProfile(false);
    };

    fetchProfile();
    return () => { cancelled = true; };
  }, [user, location.pathname]);

  // `onboardingComplete === null` with a user present is the cold-load race:
  // the mount effect ran with no user yet (checkingProfile → false), the
  // session then arrived, and this render happens BEFORE the effect refetches.
  // Without this guard that render redirects to /onboarding, which forwards
  // onboarded users to /home — so every deep link (e.g. /planner?plan=…)
  // landed on the dashboard.
  if (loading || checkingProfile || (user && onboardingComplete === null)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const isOnboardingRoute = location.pathname === "/onboarding";

  if (!onboardingComplete && !isOnboardingRoute) {
    return <Navigate to="/onboarding" replace />;
  }

  if (onboardingComplete && isOnboardingRoute) {
    return <Navigate to="/home" replace />;
  }

  return <>{children ?? <Outlet />}</>;
};

export default ProtectedRoute;
