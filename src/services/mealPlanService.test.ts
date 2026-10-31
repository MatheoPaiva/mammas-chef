import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/react", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

vi.mock("@/services/activityLogger", () => ({
  logAction: vi.fn(),
  logApiError: vi.fn(),
}));

import * as Sentry from "@sentry/react";
import { formatPinnedRecipeForGeneration, generateAndValidateMealPlan } from "./mealPlanService";
import type { MealRecipe } from "@/types/mealPlan";

const recipe: MealRecipe = {
  id: "recipe-row-id",
  libraryRecipeId: "canonical-recipe-id",
  title: "Greek Chicken Bowls",
  mealType: "dinner",
  prepTime: "20 min active / 40 min total",
  servings: 4,
  calories: 520,
  protein: 38,
  carbs: 45,
  fats: 22,
  tags: ["high-protein"],
  ingredients: [
    { name: "chicken breast", quantity: 1.5, unit: "lb", prep: "cubed" },
    { name: "tzatziki", quantity: 0.5, unit: "cup" },
  ],
  steps: ["Roast chicken.", "Serve over rice."],
};

describe("formatPinnedRecipeForGeneration", () => {
  it("preserves canonical recipe provenance and readable ingredient text", () => {
    expect(formatPinnedRecipeForGeneration(recipe)).toEqual({
      id: "recipe-row-id",
      libraryRecipeId: "canonical-recipe-id",
      title: "Greek Chicken Bowls",
      mealType: "dinner",
      ingredients: ["1.5 lb chicken breast cubed", "0.5 cup tzatziki"],
      steps: ["Roast chicken.", "Serve over rice."],
    });
  });
});

// ---------------------------------------------------------------------------
// generateAndValidateMealPlan orchestrator tests
// ---------------------------------------------------------------------------
//
// Strategy: stub global fetch with a ReadableStream that emits one SSE
// `data: { ...delta }` line containing the entire plan JSON, then `[DONE]`.
// The orchestrator's accumulator stitches the deltas back into the same JSON
// the parser will consume. This exercises the real streamMealPlan + parser +
// validator pipeline — only the network is mocked.

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function makeMeal(id: string, mealType: MealRecipe["mealType"], extra?: Partial<MealRecipe>): MealRecipe {
  return {
    id,
    title: `${id} title`,
    mealType,
    prepTime: "10 min",
    servings: 2,
    calories: 400,
    protein: 20,
    carbs: 30,
    fats: 10,
    tags: [],
    ingredients: [{ name: "x", quantity: 1, unit: "cup" }],
    steps: ["step"],
    ...extra,
  };
}

interface PlanFixtureOpts {
  /** When set, day 3 (Wednesday) dinner gets a leftover with this source_meal_id. */
  futureLeftoverSourceId?: string;
  /** When set, day 4 (Thursday) lunch gets a leftover with this source_meal_id (ghost). */
  ghostSourceId?: string;
  /** When set, day 6 (Saturday) lunch gets a leftover referencing this earlier valid id. */
  validLeftoverSourceId?: string;
  /** Override prep tips entirely. */
  prepTips?: { id?: string; day: string; tip: string; referenced_meal_ids?: string[] }[];
}

function makePlanJson(opts: PlanFixtureOpts = {}): string {
  const days = DAYS.map((day, dayIdx) => {
    const meals: MealRecipe[] = [
      makeMeal(`m-${dayIdx}-b`, "breakfast"),
      makeMeal(`m-${dayIdx}-l`, "lunch"),
      makeMeal(`m-${dayIdx}-d`, "dinner"),
    ];
    if (dayIdx === 3 && opts.futureLeftoverSourceId) {
      meals[2] = { ...meals[2], source_meal_id: opts.futureLeftoverSourceId };
    }
    if (dayIdx === 4 && opts.ghostSourceId) {
      meals[1] = { ...meals[1], source_meal_id: opts.ghostSourceId };
    }
    if (dayIdx === 6 && opts.validLeftoverSourceId) {
      meals[1] = { ...meals[1], source_meal_id: opts.validLeftoverSourceId };
    }
    return { day, meals };
  });

  const defaultPrepTips = [
    { id: "tip-1", day: "Saturday", tip: "Roast all proteins for the week", referenced_meal_ids: ["m-0-d", "m-1-d"] },
  ];

  const plan = {
    weekPlan: { title: "Test Plan", days },
    shoppingList: [],
    prepTips: opts.prepTips ?? defaultPrepTips,
  };
  return JSON.stringify(plan);
}

/** Build a Response whose body is an SSE stream that emits the given JSON as
 * a single delta chunk, then `[DONE]`. */
function makeSseResponse(jsonPayload: string): Response {
  const sseChunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: jsonPayload } }] })}\n\n`,
    `data: [DONE]\n\n`,
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of sseChunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

interface FetchCall {
  body: { retryContext?: string; prompt?: string; [k: string]: unknown };
}

function installFetchMock(plans: string[]): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  let i = 0;
  // @ts-expect-error — jsdom fetch stub
  globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const parsed = init?.body ? JSON.parse(init.body as string) : {};
    calls.push({ body: parsed });
    const payload = plans[Math.min(i, plans.length - 1)];
    i++;
    return makeSseResponse(payload);
  });
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("generateAndValidateMealPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: single attempt, no retry, onSuccess called with parsed plan", async () => {
    const validPlan = makePlanJson({ validLeftoverSourceId: "m-2-d" });
    const fetchMock = installFetchMock([validPlan]);

    const onDelta = vi.fn();
    const onRetryStart = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onValidationFailed = vi.fn();

    await generateAndValidateMealPlan({
      prompt: "test",
      accessToken: "token",
      onDelta,
      onRetryStart,
      onSuccess,
      onError,
      onValidationFailed,
    });

    expect(fetchMock.calls).toHaveLength(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0]).toMatchObject({
      weekPlan: { title: expect.any(String) },
    });
    expect(onRetryStart).not.toHaveBeenCalled();
    expect(onValidationFailed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    fetchMock.restore();
  });

  it("retry succeeds: first attempt has ghost source_meal_id, second is valid", async () => {
    const badPlan = makePlanJson({ ghostSourceId: "ghost-id-xyz" });
    const goodPlan = makePlanJson({ validLeftoverSourceId: "m-2-d" });
    const fetchMock = installFetchMock([badPlan, goodPlan]);

    const onDelta = vi.fn();
    const onRetryStart = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onValidationFailed = vi.fn();

    await generateAndValidateMealPlan({
      prompt: "test",
      accessToken: "token",
      onDelta,
      onRetryStart,
      onSuccess,
      onError,
      onValidationFailed,
    });

    expect(fetchMock.calls).toHaveLength(2);
    // First call has no retryContext; second call does and references the ghost id
    expect(fetchMock.calls[0].body.retryContext).toBeUndefined();
    expect(fetchMock.calls[1].body.retryContext).toBeDefined();
    expect(fetchMock.calls[1].body.retryContext).toContain("ghost-id-xyz");

    expect(onRetryStart).toHaveBeenCalledTimes(1);
    const retryErrors = onRetryStart.mock.calls[0][0];
    expect(Array.isArray(retryErrors)).toBe(true);
    expect(retryErrors.some((e: { code: string }) => e.code === "LEFTOVER_SOURCE_MISSING")).toBe(true);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onValidationFailed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    // Attempt-1 self-heal telemetry is a breadcrumb, not its own Sentry issue.
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Meal plan validation failed (attempt 1, self-healing)" }),
    );
    expect(Sentry.captureMessage).not.toHaveBeenCalledWith(
      "Meal plan validation failed",
      expect.anything(),
    );

    fetchMock.restore();
  });

  it("double failure: both attempts invalid, onValidationFailed fires with attempt=2", async () => {
    const bad1 = makePlanJson({ futureLeftoverSourceId: "m-5-l" }); // Wed dinner -> Fri lunch
    const bad2 = makePlanJson({ futureLeftoverSourceId: "m-5-l" });
    const fetchMock = installFetchMock([bad1, bad2]);

    const onDelta = vi.fn();
    const onRetryStart = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onValidationFailed = vi.fn();

    await generateAndValidateMealPlan({
      prompt: "test",
      accessToken: "token",
      onDelta,
      onRetryStart,
      onSuccess,
      onError,
      onValidationFailed,
    });

    expect(fetchMock.calls).toHaveLength(2);
    expect(onRetryStart).toHaveBeenCalledTimes(1);
    expect(onValidationFailed).toHaveBeenCalledTimes(1);
    const failure = onValidationFailed.mock.calls[0][0];
    expect(failure.attempt).toBe(2);
    expect(failure.errors.length).toBeGreaterThan(0);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    fetchMock.restore();
  });

  it("transient transport error on first attempt auto-retries once, then surfaces onError (FX-6)", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: number[] = [];
    // @ts-expect-error — jsdom fetch stub
    globalThis.fetch = vi.fn(async () => {
      fetchCalls.push(1);
      return new Response(JSON.stringify({ error: "network down" }), { status: 500 });
    });

    const onDelta = vi.fn();
    const onRetryStart = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onValidationFailed = vi.fn();

    await generateAndValidateMealPlan({
      prompt: "test",
      accessToken: "token",
      onDelta,
      onRetryStart,
      onSuccess,
      onError,
      onValidationFailed,
    });

    // FX-6: a transient 500 auto-retries exactly once (two fetches), then the
    // second failure surfaces via onError. Validation callbacks never fire.
    expect(fetchCalls).toHaveLength(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("network down");
    expect(onRetryStart).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onValidationFailed).not.toHaveBeenCalled();

    globalThis.fetch = originalFetch;
  });

  it("non-transient transport error (daily limit) short-circuits without auto-retry (FX-6)", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: number[] = [];
    // @ts-expect-error — jsdom fetch stub
    globalThis.fetch = vi.fn(async () => {
      fetchCalls.push(1);
      return new Response(
        JSON.stringify({ error: "You've reached the daily limit for meal plan generation. Please try again tomorrow." }),
        { status: 429 },
      );
    });

    const onDelta = vi.fn();
    const onRetryStart = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onValidationFailed = vi.fn();

    await generateAndValidateMealPlan({
      prompt: "test",
      accessToken: "token",
      onDelta,
      onRetryStart,
      onSuccess,
      onError,
      onValidationFailed,
    });

    expect(fetchCalls).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("daily limit");
    expect(onRetryStart).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onValidationFailed).not.toHaveBeenCalled();

    globalThis.fetch = originalFetch;
  });
});
