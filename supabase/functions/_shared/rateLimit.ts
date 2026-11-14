import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type ActionType = "generate" | "swap" | "shopping" | "nutrition";

const LIMITS: Record<ActionType, { max: number; eventName: string }> = {
  generate: { max: 10, eventName: "generate_meal_plan" },
  swap:     { max: 20, eventName: "meal_swap" },
  // Generous on purpose: the shopping list runs on every planner save, and a
  // nutrition 429 blocks saving a custom recipe.
  shopping:  { max: 60, eventName: "generate_shopping_list" },
  nutrition: { max: 60, eventName: "estimate_nutrition" },
};

interface Reservation {
  allowed: boolean;
  /** app_logs row holding the slot; pass it to releaseAction if the work fails. */
  id: string | null;
}

// Service role key bypasses RLS (edge functions write on behalf of the user, not as the user).
function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * Reserve one of the user's daily slots for an action: write the app_logs row
 * FIRST, then count the last 24 hours. Requests running at the same time see
 * each other's rows, so they cannot all pass on the same count (ties reject).
 */
export async function reserveAction(
  userId: string,
  action: ActionType,
  client?: SupabaseClient,
): Promise<Reservation> {
  const { max, eventName } = LIMITS[action];
  const supabase = client ?? serviceClient();

  const { data, error: insertError } = await supabase
    .from("app_logs")
    .insert({
      user_id: userId,
      event_type: "action",
      event_name: eventName,
      metadata: { source: "edge_function" },
    })
    .select("id")
    .single();

  if (insertError) {
    console.warn("[rateLimit] Failed to record action:", insertError.message);
  }
  const id: string | null = data?.id ?? null;

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
    return { allowed: true, id };
  }

  // The count includes this request's own row, unless its insert failed.
  if ((count ?? 0) > (id ? max : max - 1)) {
    await releaseAction(id, supabase);
    return { allowed: false, id: null };
  }

  return { allowed: true, id };
}

/** Give a reserved slot back, so a failed run does not use up the daily limit. */
export async function releaseAction(id: string | null, client?: SupabaseClient): Promise<void> {
  if (!id) return;
  const { error } = await (client ?? serviceClient()).from("app_logs").delete().eq("id", id);
  if (error) {
    console.warn("[rateLimit] Failed to release action:", error.message);
  }
}
