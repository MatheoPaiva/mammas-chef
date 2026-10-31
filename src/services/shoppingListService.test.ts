import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockInvoke, mockLogError, mockLogAction } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockInvoke: vi.fn(),
  mockLogError: vi.fn(),
  mockLogAction: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mockFrom,
    functions: { invoke: mockInvoke },
  },
}));

vi.mock("@/services/activityLogger", () => ({
  logAction: mockLogAction,
  logError: mockLogError,
}));

import { generateShoppingList } from "./shoppingListService";

function mockPlanInputs(options?: { insertError?: { message: string }; recipes?: unknown[] }) {
  // Widened (D-18) — meal_plan_days now also carries day_name so
  // loadPlanShoppingInputs can resolve each recipe's day_id to a day NAME.
  const mealPlanDaysEq = vi.fn().mockResolvedValue({ data: [{ id: "day-1", day_name: "Monday" }], error: null });
  const mealPlanDaysSelect = vi.fn(() => ({ eq: mealPlanDaysEq }));

  // Widened for SHOP-03 (D-15) + D-18 — id/title/meal_type/day_id feed the
  // sources[] traceability threading; status/source_meal_id feed the dual-signal
  // leftover skip.
  const recipesIn = vi.fn().mockResolvedValue({
    data: options?.recipes ?? [
      {
        id: "meal-fresh-1", ingredients: [{ name: "chicken thighs", quantity: 1, unit: "lb" }],
        status: "fresh", source_meal_id: null, title: "Lemon Chicken Bowl", meal_type: "dinner", day_id: "day-1",
      },
      {
        id: "meal-leftover-1", ingredients: [{ name: "chicken thighs", quantity: 3, unit: "lb" }],
        status: "leftover", source_meal_id: "meal-1", title: "Chicken Leftovers", meal_type: "lunch", day_id: "day-1",
      },
    ],
    error: null,
  });
  const recipesSelect = vi.fn(() => ({ in: recipesIn }));

  const planSingle = vi.fn().mockResolvedValue({
    data: { pantry_items: [], user_id: "user-1" },
    error: null,
  });
  const planEq = vi.fn(() => ({ single: planSingle }));
  const planSelect = vi.fn(() => ({ eq: planEq }));

  const shoppingListMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const shoppingListEq = vi.fn(() => ({ maybeSingle: shoppingListMaybeSingle }));
  const shoppingListSelect = vi.fn(() => ({ eq: shoppingListEq }));
  const shoppingListInsert = vi.fn().mockResolvedValue({ error: options?.insertError ?? null });

  mockFrom.mockImplementation((table: string) => {
    if (table === "meal_plan_days") return { select: mealPlanDaysSelect };
    if (table === "recipes") return { select: recipesSelect };
    if (table === "meal_plans") return { select: planSelect };
    if (table === "shopping_lists") return { select: shoppingListSelect, insert: shoppingListInsert };
    throw new Error(`Unexpected table ${table}`);
  });

  return { shoppingListInsert };
}

beforeEach(() => {
  mockFrom.mockReset();
  mockInvoke.mockReset();
  mockLogError.mockReset();
  mockLogAction.mockReset();
});

describe("generateShoppingList", () => {
  it("returns the AI-humanized list when the edge function succeeds", async () => {
    const { shoppingListInsert } = mockPlanInputs();
    mockInvoke.mockResolvedValue({
      data: {
        items: [
          { name: "Chicken thighs", quantity: "2 lbs", aisle: "Meat & Seafood" },
        ],
      },
      error: null,
    });

    const result = await generateShoppingList("plan-1");

    expect(result.source).toBe("ai");
    expect(result.items).toEqual([
      { name: "Chicken thighs", quantity: "2 lbs", aisle: "Meat & Seafood", status: "needed" },
    ]);
    expect(shoppingListInsert).toHaveBeenCalledWith({
      user_id: "user-1",
      meal_plan_id: "plan-1",
      items: result.items,
    });
  });

  it("falls back to the locally-aggregated list when the AI edge function 500s", async () => {
    const { shoppingListInsert } = mockPlanInputs();
    const fakeResponse = new Response(
      JSON.stringify({ error: "AI API key is invalid or missing permissions." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
    const httpError = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: fakeResponse,
    });
    mockInvoke.mockResolvedValue({ data: null, error: httpError });

    const result = await generateShoppingList("plan-1");

    expect(result.source).toBe("local");
    expect(result.aiError).toBe("AI API key is invalid or missing permissions.");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]).toMatchObject({ status: "needed" });
    expect(shoppingListInsert).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(
      "generate_shopping_list_ai_error",
      expect.objectContaining({ planId: "plan-1", error: "AI API key is invalid or missing permissions." }),
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      "generate_shopping_list_local_fallback",
      expect.objectContaining({ planId: "plan-1" }),
    );
  });

  it("falls back to the local list when the AI returns no items", async () => {
    const { shoppingListInsert } = mockPlanInputs();
    mockInvoke.mockResolvedValue({ data: { items: [] }, error: null });

    const result = await generateShoppingList("plan-1");

    expect(result.source).toBe("local");
    expect(result.aiError).toBe("AI returned an empty shopping list.");
    expect(result.items.length).toBeGreaterThan(0);
    expect(shoppingListInsert).toHaveBeenCalledTimes(1);
  });

  it("returns 'local-unsaved' when AI fails AND saveShoppingList rejects", async () => {
    const { shoppingListInsert } = mockPlanInputs({ insertError: { message: "DB connection lost" } });
    const fakeResponse = new Response(
      JSON.stringify({ error: "AI API key is invalid or missing permissions." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
    const httpError = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: fakeResponse,
    });
    mockInvoke.mockResolvedValue({ data: null, error: httpError });

    const result = await generateShoppingList("plan-1");

    expect(result.source).toBe("local-unsaved");
    expect(result.aiError).toBe("AI API key is invalid or missing permissions.");
    expect(result.saveError).toBe("DB connection lost");
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]).toMatchObject({ status: "needed" });
    expect(shoppingListInsert).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(
      "shopping_list_persist_error",
      expect.objectContaining({ planId: "plan-1" }),
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      "generate_shopping_list_local_unsaved",
      expect.objectContaining({ planId: "plan-1" }),
    );
  });

  it("returns 'ai-unsaved' when AI succeeds AND saveShoppingList rejects", async () => {
    const { shoppingListInsert } = mockPlanInputs({ insertError: { message: "row-level security policy violation" } });
    mockInvoke.mockResolvedValue({
      data: {
        items: [
          { name: "Chicken thighs", quantity: "2 lbs", aisle: "Meat & Seafood" },
        ],
      },
      error: null,
    });

    const result = await generateShoppingList("plan-1");

    expect(result.source).toBe("ai-unsaved");
    expect(result.saveError).toBe("row-level security policy violation");
    expect(result.items).toEqual([
      { name: "Chicken thighs", quantity: "2 lbs", aisle: "Meat & Seafood", status: "needed" },
    ]);
    expect(shoppingListInsert).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledWith(
      "shopping_list_persist_error",
      expect.objectContaining({ planId: "plan-1" }),
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      "generate_shopping_list_ai_unsaved",
      expect.objectContaining({ planId: "plan-1" }),
    );
  });

  it("skips a leftover recipe's ingredients in the locally-aggregated fallback list (SHOP-03)", async () => {
    const { shoppingListInsert } = mockPlanInputs();
    const fakeResponse = new Response(
      JSON.stringify({ error: "AI API key is invalid or missing permissions." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
    const httpError = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: fakeResponse,
    });
    mockInvoke.mockResolvedValue({ data: null, error: httpError });

    const result = await generateShoppingList("plan-1");

    expect(result.source).toBe("local");
    // Only the "fresh" 1 lb row should contribute — the "leftover" 3 lb row
    // (status:"leftover" + source_meal_id:"meal-1") must be skipped entirely.
    // Pre-implementation this aggregates to "4 lbs" (double-counted); GREEN
    // must bring it down to "1 lb".
    const chicken = result.items.find((i) => i.name.toLowerCase().includes("chicken thigh"));
    expect(chicken).toBeDefined();
    expect(chicken!.quantity).toBe("1 lb");
    expect(shoppingListInsert).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Phase 17 Plan 03 — D-18 loadPlanShoppingInputs widen + D-19 echo-id re-attach
  // -------------------------------------------------------------------------
  describe("D-18/D-19: sources[] traceability round-trip", () => {
    it("carries sources onto the locally-aggregated (non-AI) list via the widened loadPlanShoppingInputs identity+day", async () => {
      // Single fresh recipe (no leftover pairing) so the builder's aggregated
      // output has exactly one traceable source: the widened select (id, title,
      // meal_type, day_id -> day name) is what makes this possible at all.
      mockPlanInputs({
        recipes: [
          {
            id: "meal-fresh-1", ingredients: [{ name: "chicken thighs", quantity: 1, unit: "lb" }],
            status: "fresh", source_meal_id: null, title: "Lemon Chicken Bowl", meal_type: "dinner", day_id: "day-1",
          },
        ],
      });
      const fakeResponse = new Response(
        JSON.stringify({ error: "AI API key is invalid or missing permissions." }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
      const httpError = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
        context: fakeResponse,
      });
      mockInvoke.mockResolvedValue({ data: null, error: httpError });

      const result = await generateShoppingList("plan-1");

      expect(result.source).toBe("local");
      const chicken = result.items.find((i) => i.name.toLowerCase().includes("chicken thigh"));
      expect(chicken?.sources).toEqual([
        { mealId: "meal-fresh-1", title: "Lemon Chicken Bowl", day: "Monday", mealType: "dinner" },
      ]);
    });

    it("re-attaches sources by echoed id when the edge function round-trips it (post-17-08/17-10 behavior)", async () => {
      mockPlanInputs({
        recipes: [
          {
            id: "meal-fresh-1", ingredients: [{ name: "chicken thighs", quantity: 1, unit: "lb" }],
            status: "fresh", source_meal_id: null, title: "Lemon Chicken Bowl", meal_type: "dinner", day_id: "day-1",
          },
        ],
      });
      // Simulate a future edge function that echoes the client-assigned id back
      // unchanged (17-08/17-10) — this test reads whatever id tryHumanize assigned
      // from the request body rather than hardcoding the internal naming scheme.
      mockInvoke.mockImplementation(async (_name: string, opts: { body: { items: Array<{ name: string; quantity: string; aisle: string; id: string }> } }) => ({
        data: {
          items: opts.body.items.map((item) => ({
            name: item.name, quantity: item.quantity, aisle: item.aisle, id: item.id,
          })),
        },
        error: null,
      }));

      const result = await generateShoppingList("plan-1");

      expect(result.source).toBe("ai");
      const chicken = result.items.find((i) => i.name.toLowerCase().includes("chicken thigh"));
      expect(chicken?.sources).toEqual([
        { mealId: "meal-fresh-1", title: "Lemon Chicken Bowl", day: "Monday", mealType: "dinner" },
      ]);
    });

    it("degrades to sources: undefined (no fuzzy fallback) when the edge function does NOT echo the id (pre-deploy behavior)", async () => {
      mockPlanInputs({
        recipes: [
          {
            id: "meal-fresh-1", ingredients: [{ name: "chicken thighs", quantity: 1, unit: "lb" }],
            status: "fresh", source_meal_id: null, title: "Lemon Chicken Bowl", meal_type: "dinner", day_id: "day-1",
          },
        ],
      });
      // Current (pre-17-08) edge function shape — no `id` field echoed back at all.
      mockInvoke.mockResolvedValue({
        data: { items: [{ name: "Chicken thighs", quantity: "1 lb", aisle: "Meat & Seafood" }] },
        error: null,
      });

      const result = await generateShoppingList("plan-1");

      expect(result.source).toBe("ai");
      const chicken = result.items.find((i) => i.name.toLowerCase().includes("chicken thigh"));
      expect(chicken).toBeDefined();
      expect(chicken!.sources).toBeUndefined();
    });

    it("degrades to sources: undefined when the edge function echoes a mangled/unmatched id (no fuzzy re-match)", async () => {
      mockPlanInputs({
        recipes: [
          {
            id: "meal-fresh-1", ingredients: [{ name: "chicken thighs", quantity: 1, unit: "lb" }],
            status: "fresh", source_meal_id: null, title: "Lemon Chicken Bowl", meal_type: "dinner", day_id: "day-1",
          },
        ],
      });
      mockInvoke.mockResolvedValue({
        data: { items: [{ name: "Chicken thighs", quantity: "1 lb", aisle: "Meat & Seafood", id: "totally-unmatched-id" }] },
        error: null,
      });

      const result = await generateShoppingList("plan-1");

      expect(result.source).toBe("ai");
      const chicken = result.items.find((i) => i.name.toLowerCase().includes("chicken thigh"));
      expect(chicken).toBeDefined();
      expect(chicken!.sources).toBeUndefined();
    });
  });
});

describe("generateShoppingList shouldPersist (261007-slz W1)", () => {
  const aiResponse = {
    data: { items: [{ name: "Chicken thighs", quantity: "2 lbs", aisle: "Meat & Seafood" }] },
    error: null,
  };

  it("returns the AI list but never touches shopping_lists when shouldPersist() is false", async () => {
    const { shoppingListInsert } = mockPlanInputs();
    mockInvoke.mockResolvedValue(aiResponse);

    const result = await generateShoppingList("plan-1", { shouldPersist: () => false });

    expect(result.source).toBe("ai");
    expect(result.items).toEqual([{ name: "Chicken thighs", quantity: "2 lbs", aisle: "Meat & Seafood", status: "needed" }]);
    expect(shoppingListInsert).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("shopping_lists");
  });

  it("skips the write on the local-fallback path too", async () => {
    const { shoppingListInsert } = mockPlanInputs();
    mockInvoke.mockResolvedValue({ data: null, error: new Error("Edge Function returned a non-2xx status code") });

    const result = await generateShoppingList("plan-1", { shouldPersist: () => false });

    expect(result.source).toBe("local");
    expect(result.items.length).toBeGreaterThan(0);
    expect(shoppingListInsert).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("shopping_lists");
  });

  it("reads the predicate at write time, after the slow AI call, not at entry", async () => {
    const { shoppingListInsert } = mockPlanInputs();
    let current = true;
    mockInvoke.mockImplementation(async () => {
      current = false; // a newer save starts while the AI call is in flight
      return aiResponse;
    });

    await generateShoppingList("plan-1", { shouldPersist: () => current });

    expect(shoppingListInsert).not.toHaveBeenCalled();
  });

  it("still persists when shouldPersist() is true (and by default)", async () => {
    const { shoppingListInsert } = mockPlanInputs();
    mockInvoke.mockResolvedValue(aiResponse);

    await generateShoppingList("plan-1", { shouldPersist: () => true });

    expect(shoppingListInsert).toHaveBeenCalledTimes(1);
  });
});
