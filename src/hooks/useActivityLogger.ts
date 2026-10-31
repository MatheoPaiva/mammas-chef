import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { logPageView, setLoggerUserId, installGlobalErrorHandler } from "@/services/activityLogger";

/**
 * Hook that automatically logs page views on route changes
 * and installs the global error handler once.
 */
export function useActivityLogger() {
  const location = useLocation();
  const { user } = useAuth();
  const installed = useRef(false);

  // Install global error handler once
  useEffect(() => {
    if (!installed.current) {
      installGlobalErrorHandler();
      installed.current = true;
    }
  }, []);

  // Keep the activity logger's cached user ID in sync with auth state
  useEffect(() => {
    setLoggerUserId(user?.id ?? null);
  }, [user]);

  // Log page views on route change (only for authenticated users)
  useEffect(() => {
    if (user) {
      logPageView(location.pathname);
    }
  }, [location.pathname, user]);
}
