import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockLogError, mockGenerateShoppingList, mockInvalidateShoppingList } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockLogError: vi.fn(),
  mockGenerateShoppingList: vi.fn(),
  mockInvalidateShoppingList: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mockFrom },
}));

vi.mock("@/services/activityLogger", () => ({
  logAction: vi.fn(),
  logError: mockLogError,
}));

vi.mock("@/services/shoppingListService", () => ({
  generateShoppingList: mockGenerateShoppingList,
  invalidateShoppingList: mockInvalidateShoppingList,
}));

import { buildRecipeInsertPayload, insertRecipeIntoPlan, loadMealPlan, renameMealPlan, saveMealPlan, updateMealPlanStartDate } from "./mealPlanDbService";
import type { MealPlanResponse, MealRecipe, PrepTip } from "@/types/mealPlan";

beforeEach(() => {
  mockFrom.mockReset();
  mockLogError.mockReset();
  mockGenerateShoppingList.mockReset();
  mockGenerateShoppingList.mockResolvedValue([]);
  mockInvalidateShoppingList.mockReset();
  mockInvalidateShoppingList.mockResolvedValue(undefined);
});

const recipe: MealRecipe = {
  id: "library-row-id",
  libraryRecipeId: "11111111-1111-4111-8111-111111111111",
  title: "Greek Chicken Bowls",
  mealType: "dinner",
  prepTime: "20 min active / 40 min total",
  servings: 4,
  calories: 520,
  protein: 38,
  carbs: 45,
  fats: 22,
  tags: ["high-protein", "Greek-inspired"],
  ingredients: [{ name: "chicken breast", quantity: 1.5, unit: "lb", prep: "cubed" }],
  steps: ["Marinate chicken.", "Roast and serve."],
  toddlerTip: "Serve deconstructed.",
  glucoseTip: "Use extra vegetables.",
  flavorNotes: "From Mammas Chef Original",
};

describe("buildRecipeInsertPayload", () => {
  it("keeps a canonical library link while saving a stable recipe snapshot", () => {
    expect(buildRecipeInsertPayload("day-1", recipe)).toEqual({
      day_id: "day-1",
      library_recipe_id: "11111111-1111-4111-8111-111111111111",
      custom_recipe_id: null,
      title: "Greek Chicken Bowls",
      meal_type: "dinner",
      prep_time: "20 min active / 40 min total",
      servings: 4,
      calories: 520,
      protein: 38,
      carbs: 45,
      fats: 22,
      tags: ["high-protein", "Greek-inspired"],
      ingredients: [{ name: "chicken breast", quantity: 1.5, unit: "lb", prep: "cubed" }],
      steps: ["Marinate chicken.", "Roast and serve."],
      toddler_tip: "Serve deconstructed.",
      glucose_tip: "Use extra vegetables.",
      flavor_notes: "From Mammas Chef Original",
      source_meal_id: null,
      status: null,
      caution_note: null,
      workflow: null,
      storage: null,
      cook_time: null,
      total_time: null,
      batch_uses: null,
      batch_creates: null,
    });
  });

  it("persists status/workflow/storage/time/caution/source_meal_id when set (Phase 15, closes the source_meal_id persistence gap)", () => {
    expect(buildRecipeInsertPayload("day-1", {
      ...recipe,
      source_meal_id: "meal-monday-dinner",
      status: "leftover",
      cautionNote: "High sodium — not toddler-suitable",
      workflow: "Reheat covered in the microwave for 2 minutes.",
      storage: "Refrigerate up to 4 days.",
      cookTime: "10 min",
      totalTime: "10 min",
    })).toMatchObject({
      source_meal_id: "meal-monday-dinner",
      status: "leftover",
      caution_note: "High sodium — not toddler-suitable",
      workflow: "Reheat covered in the microwave for 2 minutes.",
      storage: "Refrigerate up to 4 days.",
      cook_time: "10 min",
      total_time: "10 min",
    });
  });

  it("uses null for legacy/bundled recipes without a canonical library id", () => {
    const { libraryRecipeId: _libraryRecipeId, ...legacyRecipe } = recipe;
    expect(buildRecipeInsertPayload("day-1", legacyRecipe).library_recipe_id).toBeNull();
  });

  it("keeps a custom recipe link while saving a stable recipe snapshot", () => {
    expect(buildRecipeInsertPayload("day-1", {
      ...recipe,
      libraryRecipeId: undefined,
      customRecipeId: "22222222-2222-4222-8222-222222222222",
    })).toMatchObject({
      library_recipe_id: null,
      custom_recipe_id: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("drops non-UUID library references before saving recipe snapshots", () => {
    expect(buildRecipeInsertPayload("day-1", {
      ...recipe,
      libraryRecipeId: "canonical-recipe-id",
    }).library_recipe_id).toBeNull();
    expect(buildRecipeInsertPayload("day-1", {
      ...recipe,
      customRecipeId: "custom-recipe-id",
    }).custom_recipe_id).toBeNull();
  });

  it("stores invalid nutrition values as null so database checks do not reject the plan", () => {
    expect(buildRecipeInsertPayload("day-1", {
      ...recipe,
      servings: 0,
      calories: 0,
      protein: -1,
      carbs: Number.NaN,
      fats: 12.6,
    })).toMatchObject({
      servings: null,
      calories: null,
      protein: null,
      carbs: null,
      fats: 13,
    });
  });

  it("maps uses/creates to batch_uses/batch_creates (Phase 17, BATCH-01)", () => {
    expect(buildRecipeInsertPayload("day-1", {
      ...recipe,
      uses: ["Q1", "T1"],
      creates: null,
    })).toMatchObject({
      batch_uses: ["Q1", "T1"],
      batch_creates: null,
    });

    expect(buildRecipeInsertPayload("day-1", {
      ...recipe,
      uses: undefined,
      creates: "Q1",
    })).toMatchObject({
      batch_uses: null,
      batch_creates: "Q1",
    });
  });
});

describe("insertRecipeIntoPlan", () => {
  function mockSuccessfulRecipeInsert() {
    const recipeSingle = vi.fn().mockResolvedValue({ data: { id: "new-recipe-row" }, error: null });
    const recipeSelect = vi.fn(() => ({ single: recipeSingle }));
    const recipeInsert = vi.fn(() => ({ select: recipeSelect }));
    const deleteNeq = vi.fn().mockResolvedValue({ error: null });
    const deleteEqMealType = vi.fn(() => ({ neq: deleteNeq }));
    const deleteEqDay = vi.fn(() => ({ eq: deleteEqMealType }));
    const recipeDelete = vi.fn(() => ({ eq: deleteEqDay }));

    const daySingle = vi.fn().mockResolvedValue({ data: { meal_plan_id: "plan-1" }, error: null });
    const dayEq = vi.fn(() => ({ single: daySingle }));
    const daySelect = vi.fn(() => ({ eq: dayEq }));

    mockFrom.mockImplementation((table: string) => {
      if (table === "recipes") return { insert: recipeInsert, delete: recipeDelete };
      if (table === "meal_plan_days") return { select: daySelect };
      throw new Error(`Unexpected table ${table}`);
    });

    return { recipeInsert, deleteEqDay, deleteEqMealType, deleteNeq, daySelect, dayEq };
  }

  it("inserts a recipe snapshot, replaces existing slot meals, and regenerates the AI shopping list", async () => {
    const mocks = mockSuccessfulRecipeInsert();

    await insertRecipeIntoPlan("day-1", recipe, true);

    expect(mocks.recipeInsert).toHaveBeenCalledWith(buildRecipeInsertPayload("day-1", recipe));
    expect(mocks.deleteEqDay).toHaveBeenCalledWith("day_id", "day-1");
    expect(mocks.deleteEqMealType).toHaveBeenCalledWith("meal_type", "dinner");
    expect(mocks.deleteNeq).toHaveBeenCalledWith("id", "new-recipe-row");
    expect(mocks.daySelect).toHaveBeenCalledWith("meal_plan_id");
    expect(mocks.dayEq).toHaveBeenCalledWith("id", "day-1");
    expect(mockInvalidateShoppingList).toHaveBeenCalledWith("plan-1");
    expect(mockGenerateShoppingList).toHaveBeenCalledWith("plan-1");
  });

  it("does not fail the recipe insert if post-save AI shopping-list generation fails", async () => {
    mockSuccessfulRecipeInsert();
    mockGenerateShoppingList.mockRejectedValue(new Error("shopping generation failed"));

    await expect(insertRecipeIntoPlan("day-1", recipe, false)).resolves.toBeUndefined();

    expect(mockLogError).toHaveBeenCalledWith("generate_shopping_list_after_recipe_insert_failed", {
      mealPlanId: "plan-1",
      recipe: "Greek Chicken Bowls",
      error: "shopping generation failed",
    });
  });

  it("retries with a null library reference when Supabase rejects a stale canonical link", async () => {
    const firstSingle = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "23503",
        message: "insert or update on table \"recipes\" violates foreign key constraint \"recipes_library_recipe_id_fkey\"",
        details: "Key (library_recipe_id)=(11111111-1111-4111-8111-111111111111) is not present in table \"recipe_library\".",
      },
    });
    const secondSingle = vi.fn().mockResolvedValue({ data: { id: "new-recipe-row" }, error: null });
    const recipeSelect = vi.fn()
      .mockReturnValueOnce({ single: firstSingle })
      .mockReturnValueOnce({ single: secondSingle });
    const recipeInsert = vi.fn(() => ({ select: recipeSelect }));

    const daySingle = vi.fn().mockResolvedValue({ data: { meal_plan_id: "plan-1" }, error: null });
    const dayEq = vi.fn(() => ({ single: daySingle }));
    const daySelect = vi.fn(() => ({ eq: dayEq }));

    mockFrom.mockImplementation((table: string) => {
      if (table === "recipes") return { insert: recipeInsert };
      if (table === "meal_plan_days") return { select: daySelect };
      throw new Error(`Unexpected table ${table}`);
    });

    await insertRecipeIntoPlan("day-1", recipe, false);

    expect(recipeInsert).toHaveBeenNthCalledWith(1, buildRecipeInsertPayload("day-1", recipe));
    expect(recipeInsert).toHaveBeenNthCalledWith(2, {
      ...buildRecipeInsertPayload("day-1", recipe),
      library_recipe_id: null,
    });
  });
});

describe("saveMealPlan", () => {
  it("remaps source_meal_id from the AI-era mnemonic id to the freshly generated recipe row id (leftover-swap-cascade fix)", async () => {
    const planSingle = vi.fn().mockResolvedValue({ data: { id: "plan-1" }, error: null });
    const planInsert = vi.fn(() => ({ select: () => ({ single: planSingle }) }));

    const daySingle = vi.fn().mockResolvedValue({ data: { id: "day-1" }, error: null });
    const dayInsert = vi.fn(() => ({ select: () => ({ single: daySingle }) }));

    const recipesInsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "meal_plans") return { insert: planInsert };
      if (table === "meal_plan_days") return { insert: dayInsert };
      if (table === "recipes") return { insert: recipesInsert };
      throw new Error(`Unexpected table ${table}`);
    });

    // Real save/load round-trip shape: AI-era mnemonic meal ids, a dependent
    // whose source_meal_id points at the source's mnemonic id.
    const oldSourceId = "tue-dinner";
    const mealPlan: MealPlanResponse = {
      weekPlan: {
        title: "Test Week",
        batches: [{ id: "S1", task: "Cook salmon", yield: "4 servings", storage: null, useBy: null, time: null }],
        days: [
          { day: "Tuesday", meals: [{ ...recipe, id: oldSourceId, mealType: "dinner", creates: "S1" }] },
          {
            day: "Thursday",
            meals: [{ ...recipe, id: "thu-dinner", mealType: "dinner", source_meal_id: oldSourceId, uses: ["S1"] }],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    await saveMealPlan("user-1", mealPlan);

    expect(recipesInsert).toHaveBeenCalledTimes(2);
    const sourceRow = recipesInsert.mock.calls[0][0][0];
    const dependentRow = recipesInsert.mock.calls[1][0][0];

    // Every inserted row gets a real client-generated id, never the AI-era mnemonic.
    expect(typeof sourceRow.id).toBe("string");
    expect(sourceRow.id).not.toBe(oldSourceId);
    // The dependent's source_meal_id is remapped to that same fresh id, not
    // persisted verbatim (which previously resolved to nothing after load).
    expect(dependentRow.source_meal_id).toBe(sourceRow.id);
    expect(dependentRow.source_meal_id).not.toBe(oldSourceId);
  });

  it("remaps prep-tip referenced_meal_ids to the inserted recipe row ids so a plan with skip slots keeps its tips on reload (261007-cx9 D2a)", async () => {
    const planSingle = vi.fn().mockResolvedValue({ data: { id: "plan-1" }, error: null });
    const planInsert = vi.fn((_payload: { prep_tips: unknown }) => ({ select: () => ({ single: planSingle }) }));

    const daySingle = vi.fn().mockResolvedValue({ data: { id: "day-1" }, error: null });
    const dayInsert = vi.fn(() => ({ select: () => ({ single: daySingle }) }));

    const recipesInsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "meal_plans") return { insert: planInsert };
      if (table === "meal_plan_days") return { insert: dayInsert };
      if (table === "recipes") return { insert: recipesInsert };
      throw new Error(`Unexpected table ${table}`);
    });

    const mealPlan: MealPlanResponse = {
      weekPlan: {
        title: "Test Week",
        days: [{ day: "Monday", meals: [{ ...recipe, id: "mon-dinner", mealType: "dinner" }] }],
      },
      shoppingList: [],
      prepTips: [
        { id: "tip-1", day: "Sunday", tip: "Marinate chicken for Monday dinner.", referenced_meal_ids: ["mon-dinner", "gen-unknown"] },
        { id: "tip-2", day: "Sunday", tip: "Wash produce." },
      ],
    };

    await saveMealPlan("user-1", mealPlan);

    const insertedId = recipesInsert.mock.calls[0][0][0].id;
    expect(typeof insertedId).toBe("string");
    expect(insertedId).not.toBe("mon-dinner");

    // The stored tip must point at the recipe row id that loadMealPlan returns,
    // otherwise stripSkippedDayTips drops it. Unknown ids pass through unchanged.
    const tips = planInsert.mock.calls[0][0].prep_tips as PrepTip[];
    expect(tips[0].referenced_meal_ids).toEqual([insertedId, "gen-unknown"]);
    expect(tips[1].referenced_meal_ids).toBeUndefined();
  });
});

describe("saveMealPlan in-place resave (261007-slz P3)", () => {
  // One shared call log: every per-table mock and invalidateShoppingList push to it,
  // so the tests can assert the exact write ORDER (insert new -> update row ->
  // invalidate list -> delete old).
  function mockInPlaceTables(opts: { recipesError?: string; deleteOldError?: string; updateError?: string } = {}) {
    const calls: string[] = [];
    let newDays = 0;

    const daysEq = vi.fn(async () => {
      calls.push("days.select");
      return { data: [{ id: "old-day-1" }, { id: "old-day-2" }], error: null };
    });
    const dayInsert = vi.fn((_row: unknown) => ({
      select: () => ({
        single: async () => {
          calls.push("days.insert");
          newDays += 1;
          return { data: { id: `new-day-${newDays}` }, error: null };
        },
      }),
    }));
    const dayDeleteIn = vi.fn(async (_col: string, ids: string[]) => {
      const isOld = ids.every((id) => id.startsWith("old-"));
      calls.push("days.delete");
      return { error: isOld && opts.deleteOldError ? { message: opts.deleteOldError } : null };
    });
    const recipesInsert = vi.fn(async (_rows: Array<Record<string, unknown>>) => {
      calls.push("recipes.insert");
      return { error: opts.recipesError ? { message: opts.recipesError } : null };
    });
    const planInsert = vi.fn();
    const planDelete = vi.fn();
    const planUpdate = vi.fn((_payload: Record<string, unknown>) => ({
      eq: async (_col: string, _id: string) => {
        calls.push("plans.update");
        return { error: opts.updateError ? { message: opts.updateError } : null };
      },
    }));

    mockFrom.mockImplementation((table: string) => {
      if (table === "meal_plans") return { insert: planInsert, update: planUpdate, delete: planDelete };
      if (table === "meal_plan_days") return { select: () => ({ eq: daysEq }), insert: dayInsert, delete: () => ({ in: dayDeleteIn }) };
      if (table === "recipes") return { insert: recipesInsert };
      throw new Error(`Unexpected table ${table}`);
    });
    mockInvalidateShoppingList.mockImplementation(async () => { calls.push("list.invalidate"); });

    return { calls, dayInsert, dayDeleteIn, recipesInsert, planInsert, planDelete, planUpdate };
  }

  const twoDayPlan = (): MealPlanResponse => ({
    weekPlan: {
      title: "Test Week",
      days: [
        { day: "Monday", meals: [{ ...recipe, id: "mon-dinner", mealType: "dinner", creates: "S1" }] },
        { day: "Tuesday", meals: [{ ...recipe, id: "tue-dinner", mealType: "dinner", source_meal_id: "mon-dinner", uses: ["S1"] }] },
      ],
    },
    shoppingList: [],
    prepTips: [{ id: "tip-1", day: "Sunday", tip: "Marinate for Monday.", referenced_meal_ids: ["mon-dinner"] }],
  });

  it("inserts the new rows, updates the plan row, invalidates the stored list, then deletes the old days", async () => {
    const m = mockInPlaceTables();

    const id = await saveMealPlan("user-1", twoDayPlan(), undefined, "plan-1");

    expect(id).toBe("plan-1");
    expect(m.planInsert).not.toHaveBeenCalled();
    expect(m.calls).toEqual([
      "days.select",
      "days.insert", "recipes.insert",
      "days.insert", "recipes.insert",
      "plans.update",
      "list.invalidate",
      "days.delete",
    ]);
    expect(m.dayInsert).toHaveBeenNthCalledWith(1, { meal_plan_id: "plan-1", day_name: "Monday" });
    // Only the OLD day ids are deleted (recipes cascade).
    expect(m.dayDeleteIn).toHaveBeenCalledTimes(1);
    expect(m.dayDeleteIn).toHaveBeenCalledWith("id", ["old-day-1", "old-day-2"]);
    expect(mockInvalidateShoppingList).toHaveBeenCalledTimes(1);
    expect(mockInvalidateShoppingList).toHaveBeenCalledWith("plan-1");
  });

  it("remaps prep-tip refs and source_meal_id to the freshly inserted recipe ids, like the insert path", async () => {
    const m = mockInPlaceTables();

    await saveMealPlan("user-1", twoDayPlan(), undefined, "plan-1");

    const monId = m.recipesInsert.mock.calls[0][0][0].id as string;
    const tueRow = m.recipesInsert.mock.calls[1][0][0];
    expect(monId).not.toBe("mon-dinner");
    expect(tueRow.source_meal_id).toBe(monId);
    const tips = m.planUpdate.mock.calls[0][0].prep_tips as PrepTip[];
    expect(tips[0].referenced_meal_ids).toEqual([monId]);
  });

  it("rolls back only the NEW rows when the recipes insert fails: old plan, old days and the list stay intact", async () => {
    const m = mockInPlaceTables({ recipesError: "recipes boom" });

    await expect(saveMealPlan("user-1", twoDayPlan(), undefined, "plan-1")).rejects.toThrow("recipes boom");

    expect(m.dayDeleteIn).toHaveBeenCalledTimes(1);
    expect(m.dayDeleteIn).toHaveBeenCalledWith("id", ["new-day-1"]);
    expect(m.planUpdate).not.toHaveBeenCalled();
    // deleteMealPlan never ran: no plan-row delete, no shopping_lists call.
    expect(m.planDelete).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("shopping_lists");
    expect(mockInvalidateShoppingList).not.toHaveBeenCalled();
  });

  it("keeps the NEW rows when deleting the old days fails: a lost response may have applied it (review WR-02)", async () => {
    const m = mockInPlaceTables({ deleteOldError: "delete boom" });

    await expect(saveMealPlan("user-1", twoDayPlan(), undefined, "plan-1")).rejects.toThrow("delete boom");

    // The only delete is the old-day delete: the new rows are never rolled back, so the
    // plan can end up with duplicate days (recoverable) but never with none.
    expect(m.dayDeleteIn).toHaveBeenCalledTimes(1);
    expect(m.dayDeleteIn).toHaveBeenCalledWith("id", ["old-day-1", "old-day-2"]);
    expect(m.planUpdate).toHaveBeenCalledTimes(1);
    expect(mockInvalidateShoppingList).toHaveBeenCalledWith("plan-1");
    expect(m.planDelete).not.toHaveBeenCalled();
  });

  it("rolls back only the NEW rows when the row update fails: old days, metadata and list stay intact (review WR-01)", async () => {
    const m = mockInPlaceTables({ updateError: "update boom" });

    await expect(saveMealPlan("user-1", twoDayPlan(), undefined, "plan-1")).rejects.toThrow("update boom");

    expect(m.dayDeleteIn).toHaveBeenCalledTimes(1);
    expect(m.dayDeleteIn).toHaveBeenCalledWith("id", ["new-day-1", "new-day-2"]);
    expect(mockInvalidateShoppingList).not.toHaveBeenCalled();
    expect(m.planDelete).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalledWith("shopping_lists");
  });
});

describe("start_date serialization (F6)", () => {
  // getNextStartDate() returns a LOCAL Date that keeps the current time-of-day,
  // so an evening-Pacific Monday is already Tuesday in UTC. Pin a UTC-negative
  // zone so these fail on toISOString()-based serialization in any CI zone.
  const originalTz = process.env.TZ;
  beforeAll(() => { process.env.TZ = "America/Los_Angeles"; });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("updateMealPlanStartDate writes the local calendar date, not the UTC date", async () => {
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    mockFrom.mockReturnValue({ update: updateMock });

    // Mon 2026-10-12 20:00 local == 2026-10-13T03:00Z. Built inside the test so
    // it is interpreted in the pinned zone.
    await updateMealPlanStartDate("plan-1", new Date(2026, 9, 12, 20, 0));

    expect(updateMock).toHaveBeenCalledWith({ start_date: "2026-10-12" });
    expect(eqMock).toHaveBeenCalledWith("id", "plan-1");
  });

  it("saveMealPlan inserts the local calendar date as start_date", async () => {
    const planSingle = vi.fn().mockResolvedValue({ data: { id: "plan-1" }, error: null });
    const planInsert = vi.fn(() => ({ select: () => ({ single: planSingle }) }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "meal_plans") return { insert: planInsert };
      throw new Error(`Unexpected table ${table}`);
    });

    await saveMealPlan(
      "user-1",
      { weekPlan: { title: "Test Week", batches: [], days: [] }, shoppingList: [], prepTips: [] },
      new Date(2026, 9, 12, 20, 0),
    );

    expect(planInsert).toHaveBeenCalledWith(expect.objectContaining({ start_date: "2026-10-12" }));
  });
});

describe("renameMealPlan", () => {
  it("rejects whitespace-only titles without touching Supabase", async () => {
    await expect(renameMealPlan("plan-1", "   ")).rejects.toThrow(/cannot be empty/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects titles longer than 100 characters without touching Supabase", async () => {
    const tooLong = "x".repeat(101);
    await expect(renameMealPlan("plan-1", tooLong)).rejects.toThrow(/too long/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("trims the title and issues a single update with the trimmed value", async () => {
    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    mockFrom.mockReturnValue({ update: updateMock });

    await renameMealPlan("plan-1", "  Trimmed Title  ");

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith("meal_plans");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ title: "Trimmed Title" });
    expect(eqMock).toHaveBeenCalledTimes(1);
    expect(eqMock).toHaveBeenCalledWith("id", "plan-1");
  });

  it("rethrows Supabase errors and logs them via rename_meal_plan_error", async () => {
    const eqMock = vi.fn().mockResolvedValue({ error: { message: "boom" } });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    mockFrom.mockReturnValue({ update: updateMock });

    await expect(renameMealPlan("plan-1", "Whatever")).rejects.toThrow(/boom/);
    expect(mockLogError).toHaveBeenCalledWith(
      "rename_meal_plan_error",
      expect.objectContaining({ planId: "plan-1", error: "boom" }),
    );
  });
});

describe("loadMealPlan", () => {
  /**
   * Drive the per-table query chains loadMealPlan actually calls:
   *   meal_plans     .select().eq().single()
   *   meal_plan_days .select().eq()            (awaited directly)
   *   recipes        .select().in()            (awaited directly)
   *   shopping_lists .select().eq().maybeSingle()
   */
  function mockLoadQueries(opts: {
    planRow: Record<string, unknown>;
    daysRows: Array<{ id: string; day_name: string }>;
    recipesRows?: Array<Record<string, unknown>>;
    shoppingRow?: { items: unknown } | null;
  }) {
    const { planRow, daysRows, recipesRows = [], shoppingRow = null } = opts;
    mockFrom.mockImplementation((table: string) => {
      if (table === "meal_plans") {
        return {
          select: () => ({
            eq: () => ({ single: vi.fn().mockResolvedValue({ data: planRow, error: null }) }),
          }),
        };
      }
      if (table === "meal_plan_days") {
        return { select: () => ({ eq: vi.fn().mockResolvedValue({ data: daysRows, error: null }) }) };
      }
      if (table === "recipes") {
        return { select: () => ({ in: vi.fn().mockResolvedValue({ data: recipesRows, error: null }) }) };
      }
      if (table === "shopping_lists") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: shoppingRow, error: null }) }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
  }

  // The exact Kristina f3409e16 failure mode (11-CONTEXT.md specifics): a
  // Monday-start plan whose AI prep tasks were all mis-tagged to day-1 "Monday",
  // with NO batchCookDay stored anywhere. parseISO("2026-06-15") is a Monday
  // (date-fns), so the derived prep day must be "Sunday".
  const kristinaPlanRow = {
    id: "f3409e16-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Mexican Week",
    notes: "",
    start_date: "2026-06-15", // a Monday
    pantry_items: ["olive oil"],
    skip_slots: { "Monday-snack": true },
    prep_tips: [
      { id: "tip-prep-1", day: "Monday", tip: "Roast chicken for the week (~30 min)." },
      { id: "tip-prep-2", day: "Monday", tip: "Cook rice and portion for 4 days (~20 min)." },
      { id: "tip-monday-night", day: "Monday", tip: "Set out Tuesday breakfast ingredients." },
    ],
  };

  it("derives batchCookDay='Sunday' and re-tags prep tasks for a Monday-start legacy plan (closes BLOCKER)", async () => {
    mockLoadQueries({
      planRow: kristinaPlanRow,
      daysRows: [
        { id: "day-1", day_name: "Monday" },
        { id: "day-2", day_name: "Tuesday" },
      ],
      recipesRows: [
        { id: "r1", day_id: "day-1", title: "Roast Chicken Bowls", meal_type: "dinner" },
      ],
    });

    const result = await loadMealPlan(kristinaPlanRow.id);

    // The fixture stores NO batchCookDay. Pre-fix, loadMealPlan returned the bare
    // result so weekPlan.batchCookDay was `undefined`; normalization now derives
    // it from the start_date weekday. This assertion fails if Task 1's wiring is
    // reverted — it guards the real gap, not the normalizer in isolation.
    expect(result.weekPlan.batchCookDay).toBe("Sunday");

    // Prep-day tasks (tip-prep-*) are re-tagged onto the labeled prep day.
    expect(result.prepTips.filter((t) => t.day === "Sunday").length).toBe(2);
    // The nightly tip is NOT re-tagged — it stays on its own day.
    expect(result.prepTips.find((t) => t.id === "tip-monday-night")?.day).toBe("Monday");
  });

  it("preserves skipSlots and pantryItems through the load-path normalization", async () => {
    mockLoadQueries({
      planRow: kristinaPlanRow,
      daysRows: [{ id: "day-1", day_name: "Monday" }],
    });

    const result = await loadMealPlan(kristinaPlanRow.id);

    expect(result.skipSlots).toEqual({ "Monday-snack": true });
    expect(result.pantryItems).toContain("olive oil");
    // start_date round-trips untouched (the derive reads it but does not consume it).
    expect(result.startDate).toBe("2026-06-15");
  });

  it("maps the 7 new snake_case status/workflow/storage/time columns back onto MealRecipe (Phase 15 round-trip)", async () => {
    mockLoadQueries({
      planRow: kristinaPlanRow,
      daysRows: [{ id: "day-1", day_name: "Monday" }],
      recipesRows: [
        {
          id: "r0",
          day_id: "day-1",
          title: "Roast Chicken Bowls",
          meal_type: "breakfast",
        },
        {
          id: "r1",
          day_id: "day-1",
          title: "Roast Chicken Bowls Reheated",
          meal_type: "dinner",
          source_meal_id: "r0",
          status: "leftover",
          caution_note: "High sodium — not toddler-suitable",
          workflow: "Reheat covered in the microwave for 2 minutes.",
          storage: "Refrigerate up to 4 days.",
          cook_time: "10 min",
          total_time: "10 min",
        },
      ],
    });

    const result = await loadMealPlan(kristinaPlanRow.id);
    const meal = result.weekPlan.days[0].meals.find((m) => m.id === "r1");

    expect(meal?.source_meal_id).toBe("r0");
    expect(meal?.status).toBe("leftover");
    expect(meal?.cautionNote).toBe("High sodium — not toddler-suitable");
    expect(meal?.workflow).toBe("Reheat covered in the microwave for 2 minutes.");
    expect(meal?.storage).toBe("Refrigerate up to 4 days.");
    expect(meal?.cookTime).toBe("10 min");
    expect(meal?.totalTime).toBe("10 min");
  });

  it("round-trips weekPlan.batches and recipe.uses/creates through save-then-load (Phase 17, BATCH-01)", async () => {
    mockLoadQueries({
      planRow: {
        ...kristinaPlanRow,
        batches: [
          { id: "Q1", task: "Cook quinoa", yield: "6 cups", storage: "Refrigerate up to 4 days.", useBy: "Thursday", time: "~20 min" },
        ],
      },
      daysRows: [{ id: "day-1", day_name: "Monday" }],
      recipesRows: [
        {
          id: "r0",
          day_id: "day-1",
          title: "Quinoa Taco Bowl",
          meal_type: "lunch",
          batch_creates: "Q1",
        },
        {
          id: "r1",
          day_id: "day-1",
          title: "Quinoa Taco Bowl, round two",
          meal_type: "dinner",
          batch_uses: ["Q1"],
        },
      ],
    });

    const result = await loadMealPlan(kristinaPlanRow.id);

    expect(result.weekPlan.batches).toEqual([
      { id: "Q1", task: "Cook quinoa", yield: "6 cups", storage: "Refrigerate up to 4 days.", useBy: "Thursday", time: "~20 min" },
    ]);
    const source = result.weekPlan.days[0].meals.find((m) => m.id === "r0");
    const dependent = result.weekPlan.days[0].meals.find((m) => m.id === "r1");
    expect(source?.creates).toBe("Q1");
    expect(dependent?.uses).toEqual(["Q1"]);
  });

  it("degrades gracefully on a legacy row without batch columns (weekPlan.batches === [], uses/creates undefined)", async () => {
    mockLoadQueries({
      planRow: kristinaPlanRow, // no `batches` key at all — pre-Phase-17 shape
      daysRows: [{ id: "day-1", day_name: "Monday" }],
      recipesRows: [
        { id: "r0", day_id: "day-1", title: "Roast Chicken Bowls", meal_type: "dinner" }, // no batch_uses/batch_creates keys
      ],
    });

    const result = await loadMealPlan(kristinaPlanRow.id);
    const meal = result.weekPlan.days[0].meals.find((m) => m.id === "r0");

    expect(result.weekPlan.batches).toEqual([]);
    // Every loaded plan is routed through normalizeMealPlan (17-01's parser
    // contract): uses hard-defaults to [] (tags-style whitelist), creates
    // stays undefined (source_meal_id-style) — not a symmetric default.
    expect(meal?.uses).toEqual([]);
    expect(meal?.creates).toBeUndefined();
  });

  it("falls back to positional days[0] derive when start_date is absent", async () => {
    mockLoadQueries({
      planRow: { ...kristinaPlanRow, start_date: null },
      daysRows: [{ id: "day-1", day_name: "Monday" }],
    });

    const result = await loadMealPlan(kristinaPlanRow.id);

    // No start_date hint → normalizeMealPlan derives from days[0].day ("Monday") → "Sunday".
    expect(result.weekPlan.batchCookDay).toBe("Sunday");
  });
});
