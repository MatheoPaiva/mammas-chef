import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ActionType = "generate" | "swap";

const LIMITS: Record<ActionType, { max: number; eventName: string }> = {
  generate: { max: 10, eventName: "generate_meal_plan" },
  swap:     { max: 20, eventName: "meal_swap" },
};

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Check per-user rate limit by counting server-side log entries
 * in app_logs for the last 24 hours.
 *
 * Uses the service role key to bypass RLS (edge functions write
 * on behalf of the user, not as the user).
 */
export async function checkRateLimit(
  userId: string,
  action: ActionType,
): Promise<RateLimitResult> {
  const { max, eventName } = LIMITS[action];

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("app_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event_type", "action")
    .eq("event_name", eventName)
    .gte("created_at", since);

  if (error) {
    // If the query fails, allow the request but log a warning.
    // We don't want a logging-table outage to block all users.
    console.warn("[rateLimit] Failed to query app_logs:", error.message);
    return { allowed: true, remaining: max };
  }

  const used = count ?? 0;
  const remaining = Math.max(0, max - used);

  return { allowed: used < max, remaining };
}

/**
 * Record a rate-limited action server-side so it can't be bypassed
 * by skipping client-side logging.
 */
export async function recordAction(
  userId: string,
  action: ActionType,
): Promise<void> {
  const { eventName } = LIMITS[action];

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase.from("app_logs").insert({
    user_id: userId,
    event_type: "action",
    event_name: eventName,
    metadata: { source: "edge_function" },
  });

  if (error) {
    console.warn("[rateLimit] Failed to record action:", error.message);
  }
}
