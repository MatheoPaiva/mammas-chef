import * as Sentry from "@sentry/react";
import { logAction, logApiError } from "@/services/activityLogger";
import { streamSSE } from "@/services/streamSSE";
import { captureUnlessRateLimit } from "@/lib/sentryExpected";
import type { MealRecipe, PrepTip, SkipSlots } from "@/types/mealPlan";

const SWAP_MEAL_URL = `${(import.meta.env.VITE_SUPABASE_URL || "").trim()}/functions/v1/swap-meal`;

export async function streamMealSwap({
  oldMeal,
  dayLabel,
  mealType,
  remainingMeals,
  currentPrepTips,
  hint,
  dependentSource,
  skipSlots,
  accessToken,
  onDelta,
  onDone,
  onError,
}: {
  oldMeal: MealRecipe;
  dayLabel: string;
  mealType: string;
  remainingMeals: Pick<MealRecipe, "id" | "title" | "mealType" | "ingredients">[];
  currentPrepTips: PrepTip[];
  hint?: string;
  /** D-11: sizing context when the outgoing meal has dependent leftovers — edge reads it optionally. */
  dependentSource?: { count: number; servingsSum: number };
  /** The plan's skipped slots: lets the edge put the new meal's night-before tip on the previous active cook night. */
  skipSlots?: SkipSlots;
  /** Pass the access token from AuthContext so we never call supabase.auth.* here. */
  accessToken: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  try {
    logAction("meal_swap_start", { dayLabel, mealType, hasHint: !!hint });

    const token = accessToken;

    const resp = await fetch(SWAP_MEAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ oldMeal, dayLabel, mealType, remainingMeals, currentPrepTips, hint, dependentSource, skipSlots }),
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({ error: "Request failed" }));
      const errMsg = errorData.error || errorData.msg || errorData.message || `Error ${resp.status}`;
      captureUnlessRateLimit(`Meal swap API error: ${errMsg}`, { level: "error", tags: { feature: "swap", action: "api_response" }, extra: { status: resp.status, errorData } }, { errorText: errMsg, status: resp.status });
      logApiError("meal_swap_failed", { status: resp.status, error: errMsg });
      onError(errMsg);
      return;
    }

    const { streamDone, errored } = await streamSSE(resp, {
      warnTag: "SSE swap",
      onDelta,
      onError,
    });
    if (errored) return;

    if (!streamDone) {
      Sentry.captureMessage("Meal swap stream ended without [DONE]", { level: "error", tags: { feature: "swap", action: "stream_incomplete" } });
      onError("Stream ended unexpectedly");
      return;
    }

    logAction("meal_swap_complete", { dayLabel, mealType });
    onDone();
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: "swap", action: "stream_error" } });
    const msg = e instanceof Error ? e.message : "Unknown error";
    logApiError("meal_swap_error", { error: msg });
    onError(msg);
  }
}
