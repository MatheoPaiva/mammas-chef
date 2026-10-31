import * as Sentry from "@sentry/react";
import { logAction, logApiError } from "@/services/activityLogger";
import { streamSSE } from "@/services/streamSSE";
import { captureUnlessRateLimit } from "@/lib/sentryExpected";

import type { MealRecipe, MealPlanResponse } from "@/types/mealPlan";
import { parseMealPlanResponse } from "@/lib/mealPlanParser";
import {
  validateMealPlanDependencies,
  type ValidationError,
} from "@/lib/mealPlanValidation";

const MEAL_PLAN_URL = `${(import.meta.env.VITE_SUPABASE_URL || "").trim()}/functions/v1/generate-meal-plan`;

export function formatPinnedRecipeForGeneration(recipe: MealRecipe) {
  return {
    id: recipe.id,
    libraryRecipeId: recipe.libraryRecipeId,
    customRecipeId: recipe.customRecipeId,
    title: recipe.title,
    mealType: recipe.mealType,
    ingredients: recipe.ingredients.map((ingredient) => {
      // WR-07: quantity===0 is a sentinel for "to taste" ingredients
      // (e.g. salt). Stringifying it produced output like "0 salt to
      // taste", which the AI dutifully copied into generated steps.
      // Treat 0 as absent and skip empty unit/prep cleanly.
      const parts: string[] = [];
      if (typeof ingredient.quantity === "number" && ingredient.quantity !== 0) {
        parts.push(String(ingredient.quantity));
      }
      if (ingredient.unit && ingredient.unit.trim() !== "") parts.push(ingredient.unit);
      parts.push(ingredient.name);
      if (ingredient.prep && ingredient.prep.trim() !== "") parts.push(ingredient.prep);
      return parts.join(" ");
    }),
    steps: recipe.steps,
  };
}

export async function streamMealPlan({
  prompt,
  pinnedRecipes,
  skipSlots,
  startDate,
  retryContext,
  accessToken,
  signal,
  onDelta,
  onDone,
  onError,
}: {
  prompt: string;
  pinnedRecipes?: MealRecipe[];
  skipSlots?: Record<string, true>;
  /**
   * ISO `yyyy-mm-dd` first-day of the plan week. Used by the edge function to
   * inject a concrete "Week of …" date into the AI title instruction. Optional;
   * the edge function silently ignores anything that doesn't match yyyy-mm-dd.
   */
  startDate?: string;
  /**
   * Optional addendum appended to the edge function's system prompt naming
   * specific validation failures from a prior attempt. Constructed by
   * `generateAndValidateMealPlan` (Plan 07-05) from ValidationError messages
   * produced by `validateMealPlanDependencies` (Plan 07-04). Edge function
   * (Plan 07-06) validates and caps at 8000 chars.
   */
  retryContext?: string;
  /** Pass the access token from AuthContext so we never call supabase.auth.* here. */
  accessToken: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  try {
    logAction("generate_meal_plan_start", { pinnedCount: pinnedRecipes?.length ?? 0, skippedCount: skipSlots ? Object.keys(skipSlots).length : 0, isRetry: !!retryContext });

    const token = accessToken;

    const requestStartTime = Date.now();
    const resp = await fetch(MEAL_PLAN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        prompt,
        pinnedRecipes: pinnedRecipes?.map(formatPinnedRecipeForGeneration),
        skipSlots,
        startDate,
        retryContext,
      }),
      signal,
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({ error: "Request failed" }));
      console.error("[MealPlan] Error response:", resp.status, errorData);
      const errMsg = errorData.error || errorData.msg || errorData.message || `Error ${resp.status}`;
      captureUnlessRateLimit(`Meal plan API error: ${errMsg}`, { level: "error", tags: { feature: "generation", action: "api_response" }, extra: { status: resp.status, errorData } }, { errorText: errMsg, status: resp.status });
      logApiError("generate_meal_plan_failed", { status: resp.status, error: errMsg });
      onError(errMsg);
      return;
    }

    const streamStartTime = Date.now();
    let firstTokenMs: number | null = null;
    // FX-6: count total delta chars so the without-[DONE] Sentry event can tell
    // died-at-0% (isolate killed before any content) from died-at-99% (severed
    // near the end). Wrapping onDelta leaves forwarded behavior unchanged.
    let contentChars = 0;

    const { streamDone, errored, remainingBuffer } = await streamSSE(resp, {
      warnTag: "SSE",
      onDelta: (text: string) => {
        contentChars += text.length;
        onDelta(text);
      },
      onError,
      onFirstToken: () => {
        firstTokenMs = Date.now() - streamStartTime;
      },
      finalFlushSetsDone: true,
    });
    if (errored) return;

    if (!streamDone) {
      const elapsed = ((Date.now() - streamStartTime) / 1000).toFixed(1);
      console.error(`[MealPlan] Stream ended without [DONE] after ${elapsed}s (${contentChars} content chars). Remaining buffer: "${remainingBuffer.slice(0, 200)}"`);
      Sentry.captureMessage("Meal plan stream ended without [DONE]", { level: "error", tags: { feature: "generation", action: "stream_incomplete" }, extra: { elapsedSeconds: elapsed, contentChars, bufferPreview: remainingBuffer.slice(0, 200) } });
      onError("Stream ended unexpectedly");
      return;
    }

    const totalStreamMs = Date.now() - streamStartTime;
    // ttftMs/totalStreamMs start at the response headers (unchanged, so historical
    // app_logs stay comparable); headersMs/requestMs cover the wait before them.
    logAction("generate_meal_plan_complete", {
      ttftMs: firstTokenMs ?? totalStreamMs,
      totalStreamMs,
      headersMs: streamStartTime - requestStartTime,
      requestMs: Date.now() - requestStartTime,
    });
    onDone();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return; // cancelled by caller
    Sentry.captureException(e, { tags: { feature: "generation", action: "stream_error" } });
    const msg = e instanceof Error ? e.message : "Unknown error";
    logApiError("generate_meal_plan_error", { error: msg });
    onError(msg);
  }
}

/**
 * Build a retry-context addendum that the edge function appends to the system
 * prompt. Composed entirely of validator-produced strings — never raw AI output
 * recipe titles or pantry input — so prompt-injection risk is bounded (T-07-11).
 */
function formatRetryContext(errors: ValidationError[]): string {
  // Sanitize each validator-produced message before concatenating into the
  // retry addendum. ValidationError.message interpolates AI-emitted free
  // text (tip.tip) and AI-emitted IDs (sourceId) — both unvalidated. Strip
  // newlines and markdown-control characters and cap each bullet to 400
  // chars so a single malicious value cannot forge headers, escape the
  // bullet, or impersonate prompt instructions. Defense in depth: the edge
  // function applies the same sanitization on receipt (CR-01).
  const bullets = errors
    .map((e) => `- ${e.message.replace(/[\r\n`#>]/g, " ").slice(0, 400)}`)
    .join("\n");
  return `Your previous attempt produced a plan with unresolved meal references that must be fixed:\n\n${bullets}\n\nRegenerate the full week so that:\n- Every leftover meal's source_meal_id points to a meal that exists earlier in the same week (earlier day, or same day at an earlier mealType slot).\n- ANY meal tagged "leftover" / "leftovers" / "reheat" MUST set source_meal_id pointing to a real earlier meal in this plan. No phantom leftovers — if a meal is a leftover, it has to be a leftover OF something that actually exists earlier in the week.
- Recipe titles MUST NOT contain "(from X)" or "(leftover from X)" annotations. Source attribution belongs ONLY in the source_meal_id field. If you want to mark a meal as a leftover, set source_meal_id — do not put it in the title.\n- Recipe STEP text MUST NOT promise a specific downstream consumer day or mealType (no "refrigerate for Wednesday lunch", "portion for Friday's dinner", etc.). Either set source_meal_id on the consumer meal so the link is real, or write generic portioning steps ("Portion leftovers into airtight containers for later use.").\n- Recipe INGREDIENT lines MUST NOT reference a source meal by day/mealType (no "from Monday dinner", "from Tuesday lunch", etc.). If the meal is a leftover, set source_meal_id; the display layer handles the provenance label.\n- Every prepTip.referenced_meal_ids[] entry that you include must point to a meal that exists in the plan.\n- Day 1 of the week has no leftover meals.\nApply all other quality rules from the main system prompt.`;
}

export interface ValidationFailedError {
  attempt: 1 | 2;
  errors: ValidationError[];
}

/**
 * Service-level orchestrator: streams a meal plan from the edge function, runs
 * the post-parse dependency validator (Plan 07-04), and issues exactly ONE
 * retry with a `retryContext` addendum if the first attempt fails validation.
 *
 * Callback semantics:
 *   - onDelta: forwarded for every SSE content chunk (both attempts).
 *   - onRetryStart: fired ONCE between attempts when validation fails on the
 *     first stream. UI should show a non-blocking informational toast.
 *   - onSuccess: fired ONCE with the parsed+validated plan; caller handles
 *     enrichment, shopping list seed, setMealPlan, save, etc.
 *   - onError: transport / parse failure on either attempt. Existing semantics.
 *   - onValidationFailed: fired ONCE only when validation fails on the SECOND
 *     attempt. UI should show a destructive toast and MUST NOT save the plan.
 */
export async function generateAndValidateMealPlan(params: {
  prompt: string;
  pinnedRecipes?: MealRecipe[];
  skipSlots?: Record<string, true>;
  startDate?: string;
  accessToken: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onRetryStart: (errors: ValidationError[]) => void;
  onSuccess: (parsed: MealPlanResponse) => Promise<void> | void;
  onError: (errorMessage: string) => void;
  onValidationFailed: (failure: ValidationFailedError) => void;
}): Promise<void> {
  let accumulated = "";
  const collectDelta = (chunk: string) => {
    accumulated += chunk;
    params.onDelta(chunk);
  };

  const runAttempt = async (
    retryContext?: string,
  ): Promise<
    | { ok: true; parsed: MealPlanResponse }
    | { ok: false; transport: string }
  > => {
    accumulated = ""; // fresh per attempt — the second call gets a clean buffer
    let transportError: string | undefined;
    let streamDone = false;

    await streamMealPlan({
      prompt: params.prompt,
      pinnedRecipes: params.pinnedRecipes,
      skipSlots: params.skipSlots,
      startDate: params.startDate,
      retryContext,
      accessToken: params.accessToken,
      signal: params.signal,
      onDelta: collectDelta,
      onDone: () => {
        streamDone = true;
      },
      onError: (msg) => {
        transportError = msg;
      },
    });

    if (transportError) return { ok: false, transport: transportError };
    if (!streamDone) return { ok: false, transport: "Stream ended without DONE" };

    try {
      const parsed = parseMealPlanResponse(accumulated);
      return { ok: true, parsed };
    } catch (e) {
      return {
        ok: false,
        transport: e instanceof Error ? e.message : "Parse failed",
      };
    }
  };

  // CR-02 / WR-08: Bail out early if the caller has already aborted at any
  // phase boundary. streamMealPlan swallows AbortError silently and the
  // orchestrator would otherwise mis-report cancellation as a transport
  // failure ("Stream ended without DONE") in Sentry.
  if (params.signal?.aborted) return;

  // First attempt (FX-6: auto-retry once on a transient transport failure —
  // the July 5 incident was a worker kill mid-call that the user had to re-click
  // through manually). Skip the auto-retry for non-transient failures (daily
  // rate limit / auth) where a retry only wastes a round-trip.
  let first = await runAttempt();
  if (params.signal?.aborted) return;
  if (!first.ok) {
    const nonTransient = /daily limit|reached the daily limit|unauthorized|not authenticated|\b401\b|\b403\b/i.test(first.transport);
    if (nonTransient) {
      params.onError(first.transport);
      return;
    }
    Sentry.captureMessage("Meal plan transport auto-retry", {
      level: "info",
      tags: { feature: "generation", action: "transport_auto_retry" },
      extra: { firstError: first.transport },
    });
    if (params.signal?.aborted) return;
    first = await runAttempt();
    if (params.signal?.aborted) return;
    if (!first.ok) {
      params.onError(first.transport);
      return;
    }
  }

  const firstValidation = validateMealPlanDependencies(first.parsed);
  if (firstValidation.valid) {
    await params.onSuccess(first.parsed);
    return;
  }

  // Validation failed — log + emit retry signal + retry once
  Sentry.addBreadcrumb({
    category: "validation",
    level: "warning",
    message: "Meal plan validation failed (attempt 1, self-healing)",
    data: { attempt: 1, errors: firstValidation.errors },
  });
  logApiError("generate_meal_plan_validation_failed", {
    errors: firstValidation.errors,
    attempt: 1,
  });
  params.onRetryStart(firstValidation.errors);

  if (params.signal?.aborted) return;
  const retryContext = formatRetryContext(firstValidation.errors);
  const second = await runAttempt(retryContext);
  if (params.signal?.aborted) return;
  if (!second.ok) {
    params.onError(second.transport);
    return;
  }

  const secondValidation = validateMealPlanDependencies(second.parsed);
  if (secondValidation.valid) {
    await params.onSuccess(second.parsed);
    return;
  }

  // Second failure — block save
  Sentry.captureMessage("Meal plan validation failed after retry", {
    level: "error",
    tags: { feature: "generation", action: "validation_retry_failed", attempt: "2" },
    extra: { errors: secondValidation.errors },
  });
  logApiError("generate_meal_plan_validation_retry_failed", {
    errors: secondValidation.errors,
  });
  params.onValidationFailed({ attempt: 2, errors: secondValidation.errors });
}
