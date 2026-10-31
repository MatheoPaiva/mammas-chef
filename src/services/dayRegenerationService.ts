/**
 * Client-side streaming service for the regenerate-day edge function.
 * Mirrors the pattern from mealSwapService.ts.
 */
import * as Sentry from "@sentry/react";
import { logAction, logApiError } from "@/services/activityLogger";
import { streamSSE } from "@/services/streamSSE";
import type { MealRecipe, PrepTip, SkipSlots } from "@/types/mealPlan";

const REGEN_DAY_URL = `${(import.meta.env.VITE_SUPABASE_URL || "").trim()}/functions/v1/regenerate-day`;

export async function streamDayRegeneration({
  dayLabel,
  activeMealTypes,
  remainingMeals,
  currentPrepTips,
  hint,
  batches,
  skipSlots,
  replacedMealIds,
  accessToken,
  onDelta,
  onDone,
  onError,
}: {
  dayLabel: string;
  activeMealTypes: string[];
  remainingMeals: Pick<MealRecipe, "id" | "title" | "mealType" | "ingredients">[];
  currentPrepTips: PrepTip[];
  hint?: string;
  /** D-13: the plan's existing batch table, injected as prompt context — edge reads it optionally. */
  batches?: import("@/types/mealPlan").PrepBatch[];
  /** The plan's skipped slots: lets the edge put the day's night-before tip on the previous active cook night. */
  skipSlots?: SkipSlots;
  /** The regenerated day's current meal ids. Sending the array (even empty, for a missing day) opts into prep-tip merging; the edge leaves the tips unchanged without it. */
  replacedMealIds: string[];
  accessToken: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  try {
    logAction("day_regen_start", { dayLabel, mealTypes: activeMealTypes.join(",") });

    const resp = await fetch(REGEN_DAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ dayLabel, activeMealTypes, remainingMeals, currentPrepTips, hint, batches, skipSlots, replacedMealIds }),
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({ error: "Request failed" }));
      const errMsg = errorData.error || errorData.msg || errorData.message || `Error ${resp.status}`;
      Sentry.captureMessage(`Day regeneration API error: ${errMsg}`, { level: "error", tags: { feature: "regen-day", action: "api_response" }, extra: { status: resp.status, errorData } });
      logApiError("day_regen_failed", { status: resp.status, error: errMsg });
      onError(errMsg);
      return;
    }

    const { streamDone, errored } = await streamSSE(resp, {
      warnTag: "SSE regen-day",
      onDelta,
      onError,
    });
    if (errored) return;

    if (!streamDone) {
      Sentry.captureMessage("Day regeneration stream ended without [DONE]", { level: "error", tags: { feature: "regen-day", action: "stream_incomplete" } });
      onError("Stream ended unexpectedly");
      return;
    }

    logAction("day_regen_complete", { dayLabel });
    onDone();
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: "regen-day", action: "stream_error" } });
    const msg = e instanceof Error ? e.message : "Unknown error";
    logApiError("day_regen_error", { error: msg });
    onError(msg);
  }
}
