import { describe, expect, it } from "vitest";
import { remapTipRefs, scaleRecipeServings, skipMealInPlan } from "./planEdits";
import { stripSkippedDayTips } from "@/lib/mealPlanParser";
import type { DayPlan, MealPlanResponse, MealRecipe, PrepTip, SkipSlots } from "@/types/mealPlan";

function meal(overrides: Partial<MealRecipe> & Pick<MealRecipe, "id" | "mealType" | "title">): MealRecipe {
  return {
    prepTime: "10 min",
    servings: 4,
    calories: 400,
    protein: 30,
    carbs: 30,
    fats: 15,
    tags: [],
    ingredients: [],
    steps: [],
    ...overrides,
  };
}

function plan(days: DayPlan[], extra: Partial<MealPlanResponse> = {}): MealPlanResponse {
  return { weekPlan: { title: "Test Week", days, batches: [] }, shoppingList: [], prepTips: [], ...extra };
}

describe("scaleRecipeServings", () => {
  const recipe = meal({
    id: "mon-dinner",
    mealType: "dinner",
    title: "Roast Chicken",
    servings: 2,
    ingredients: [
      { name: "chicken thighs", quantity: 0.5, unit: "lb", displayQuantity: "1/2" },
      { name: "cumin", quantity: 0.333, unit: "tsp", displayQuantity: "1/3" },
      { name: "salt", quantity: 0, unit: "", displayQuantity: "0" },
    ],
  });

  it("scales 2 -> 4: doubles quantities (2dp) and displayQuantity, leaves macros and zero-quantity lines untouched", () => {
    const scaled = scaleRecipeServings(recipe, 4);

    expect(scaled).not.toBe(recipe);
    expect(scaled.servings).toBe(4);
    expect(scaled.ingredients[0]).toEqual({ name: "chicken thighs", quantity: 1, unit: "lb", displayQuantity: "1" });
    expect(scaled.ingredients[1]).toEqual({ name: "cumin", quantity: 0.67, unit: "tsp", displayQuantity: "2/3" });
    expect(scaled.ingredients[2]).toBe(recipe.ingredients[2]);
    expect([scaled.calories, scaled.protein, scaled.carbs, scaled.fats]).toEqual([400, 30, 30, 15]);
    // Input untouched.
    expect(recipe.servings).toBe(2);
    expect(recipe.ingredients[0].quantity).toBe(0.5);
  });

  it("returns the same object for invalid or equal targets", () => {
    for (const target of [2, 0, -1, 2.5, NaN]) expect(scaleRecipeServings(recipe, target)).toBe(recipe);
    const noServings = meal({ id: "x", mealType: "snack", title: "Fruit", servings: 0 });
    expect(scaleRecipeServings(noServings, 3)).toBe(noServings);
  });
});

describe("skipMealInPlan", () => {
  function buildFixture(): MealPlanResponse {
    const p = plan(
      [
        {
          day: "Monday",
          meals: [
            meal({ id: "mon-lunch", mealType: "lunch", title: "Quinoa Bowl", uses: ["Q1"] }),
            meal({ id: "mon-dinner", mealType: "dinner", title: "Roast Chicken", creates: "S1" }),
          ],
        },
        {
          day: "Tuesday",
          meals: [
            meal({ id: "tue-lunch", mealType: "lunch", title: "Leftover Roast Chicken", source_meal_id: "mon-dinner" }),
            meal({ id: "tue-dinner", mealType: "dinner", title: "Chicken Tacos", uses: ["S1"] }),
          ],
        },
      ],
      {
        shoppingList: [{ name: "chicken thighs", quantity: "2 lb", aisle: "Meat", status: "needed" }],
        prepTips: [
          { day: "Sunday", tip: "Marinate the chicken.", referenced_meal_ids: ["mon-dinner"] },
          { day: "Sunday", tip: "Cook a pot of quinoa.", referenced_meal_ids: ["mon-lunch"] },
        ],
      },
    );
    p.weekPlan.batches = [
      { id: "S1", task: "Roast chicken.", yield: "4 servings", storage: null, useBy: null, time: null },
      { id: "Q1", task: "Cook quinoa.", yield: "4 cups", storage: null, useBy: null, time: null },
    ];
    return p;
  }

  it("sets the skip key, removes the meal + dependents, drops the orphaned batch, clears the list, strips the orphaned tip", () => {
    const p = buildFixture();
    const { plan: next, removedDependents } = skipMealInPlan(p, 0, "dinner");

    expect(next).not.toBe(p);
    expect(next.skipSlots).toEqual({ "Monday:dinner": true });
    expect(next.weekPlan.days[0].meals.map((m) => m.id)).toEqual(["mon-lunch"]);
    expect(next.weekPlan.days[1].meals).toEqual([]);
    expect(removedDependents).toEqual([
      { day: "Tuesday", mealType: "lunch", title: "Leftover Roast Chicken" },
      { day: "Tuesday", mealType: "dinner", title: "Chicken Tacos" },
    ]);
    expect(next.weekPlan.batches!.map((b) => b.id)).toEqual(["Q1"]);
    expect(next.shoppingList).toEqual([]);
    expect(next.prepTips.map((t) => t.tip)).toEqual(["Cook a pot of quinoa."]);
    // Input untouched.
    expect(p.skipSlots).toBeUndefined();
    expect(p.weekPlan.days[0].meals).toHaveLength(2);
    expect(p.weekPlan.batches).toHaveLength(2);
  });

  it("removes by object identity when another meal shares the id", () => {
    const monDinner = meal({ id: "d1", mealType: "dinner", title: "A" });
    const tueDinner = meal({ id: "d1", mealType: "dinner", title: "B" });
    const p = plan([
      { day: "Monday", meals: [monDinner] },
      { day: "Tuesday", meals: [tueDinner] },
    ]);

    const { plan: next } = skipMealInPlan(p, 0, "dinner");

    expect(next.weekPlan.days[0].meals).toEqual([]);
    expect(next.weekPlan.days[1].meals[0]).toBe(tueDinner);
  });

  it("drops a batch the skipped CONSUMER used once nothing else uses it (D-12 parity with swap)", () => {
    const p = buildFixture();
    const { plan: next, removedDependents } = skipMealInPlan(p, 1, "dinner");

    expect(removedDependents).toEqual([]);
    expect(next.weekPlan.days[0].meals.map((m) => m.id)).toEqual(["mon-lunch", "mon-dinner"]);
    expect(next.weekPlan.days[1].meals.map((m) => m.id)).toEqual(["tue-lunch"]);
    // S1 lost its last consumer (tue-dinner); Q1 is still used by mon-lunch.
    expect(next.weekPlan.batches!.map((b) => b.id)).toEqual(["Q1"]);
  });

  it("returns the same plan when the slot is missing", () => {
    const p = buildFixture();
    expect(skipMealInPlan(p, 5, "dinner")).toEqual({ plan: p, removedDependents: [] });
    expect(skipMealInPlan(p, 0, "snack").plan).toBe(p);
  });
});

describe("skipMealInPlan — night-before tip re-home (261007-slz P2)", () => {
  /** Dinner-only, Monday-start week (prep day Sunday): one dinner Monday-Thursday,
   * breakfast/lunch/snack skipped on each of those days. */
  function dinnerOnlyWeek(opts: { tuesdayAlreadySkipped?: boolean; extraTips?: PrepTip[] } = {}): MealPlanResponse {
    const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday"];
    const skipSlots: SkipSlots = {};
    for (const d of dayNames) for (const t of ["breakfast", "lunch", "snack"]) skipSlots[`${d}:${t}`] = true;
    if (opts.tuesdayAlreadySkipped) skipSlots["Tuesday:dinner"] = true;
    const days: DayPlan[] = dayNames
      .filter((d) => !(opts.tuesdayAlreadySkipped && d === "Tuesday"))
      .map((d) => ({
        day: d,
        meals: [meal({ id: `${d.slice(0, 3).toLowerCase()}-dinner`, mealType: "dinner", title: `${d} dinner` })],
      }));
    const p = plan(days, {
      skipSlots,
      prepTips: [
        { id: "tip-prep-4", day: "Sunday", tip: "Marinate the chicken and freeze it for Thursday dinner.", referenced_meal_ids: ["thu-dinner"] },
        { id: "tip-tuesday-night", day: "Tuesday", tip: "Portion the rice for tomorrow's dinner.", referenced_meal_ids: ["wed-dinner"] },
        { id: "tip-wednesday-night", day: "Wednesday", tip: "Thaw the chicken for Thursday's souvlaki.", referenced_meal_ids: ["thu-dinner"] },
        { id: "tip-legacy", day: "Wednesday", tip: "Wipe down the counters." },
        ...(opts.extraTips ?? []),
      ],
    });
    p.weekPlan.batchCookDay = "Sunday";
    return p;
  }

  it("moves a thaw tip that still has a live meal one night back instead of dropping it", () => {
    const { plan: next } = skipMealInPlan(dinnerOnlyWeek(), 2, "dinner");

    // tip-tuesday-night lost its only ref and tip-legacy sits on the emptied day: both go.
    expect(next.prepTips).toEqual([
      { id: "tip-prep-4", day: "Sunday", tip: "Marinate the chicken and freeze it for Thursday dinner.", referenced_meal_ids: ["thu-dinner"] },
      { id: "tip-wednesday-night", day: "Tuesday", tip: "Thaw the chicken for Thursday's souvlaki.", referenced_meal_ids: ["thu-dinner"] },
    ]);
  });

  it("drops the tip when the night before is itself a skipped cook day (food-safety bound: one night only)", () => {
    const { plan: next } = skipMealInPlan(dinnerOnlyWeek({ tuesdayAlreadySkipped: true }), 1, "dinner");

    expect(next.prepTips.map((t) => t.id)).toEqual(["tip-prep-4"]);
    expect(next.prepTips.some((t) => t.day === "Monday")).toBe(false);
  });

  it("re-homes a first-day tip onto the prep day", () => {
    const extra: PrepTip = { id: "tip-monday-night", day: "Monday", tip: "Soak the black beans for Tuesday's bowls.", referenced_meal_ids: ["tue-dinner"] };
    const { plan: next } = skipMealInPlan(dinnerOnlyWeek({ extraTips: [extra] }), 0, "dinner");

    expect(next.prepTips.find((t) => t.id === "tip-monday-night")).toEqual({ ...extra, day: "Sunday" });
  });

  it("never moves prep-day tasks when the prep day itself is emptied", () => {
    const p = dinnerOnlyWeek();
    for (const t of ["breakfast", "lunch", "snack"]) p.skipSlots![`Sunday:${t}`] = true;
    p.weekPlan.days = [
      { day: "Sunday", meals: [meal({ id: "sun-dinner", mealType: "dinner", title: "Sunday dinner" })] },
      ...p.weekPlan.days,
    ];
    const { plan: next } = skipMealInPlan(p, 0, "dinner");

    expect(next.prepTips.find((t) => t.id === "tip-prep-4")?.day).toBe("Sunday");
  });
});

describe("remapTipRefs — regen delta tip refs (261007-slz W4)", () => {
  const GEN = "gen-7c1f0a52";
  // A missing day regenerated: its only meal carries a client-minted gen- id.
  const missingDayPlan = plan(
    [{ day: "Wednesday", meals: [meal({ id: GEN, mealType: "dinner", title: "Regenerated dinner" })] }],
    { skipSlots: { "Tuesday:dinner": true } },
  );
  const delta: PrepTip[] = [
    { id: "tip-regen-wednesday-1", day: "Sunday", tip: "Soak the beans for Wednesday dinner.", referenced_meal_ids: ["wed-dinner"] },
  ];

  it("maps the model's ids to the client's ids so the strip keeps the tip", () => {
    // Unmapped, the strip cannot resolve the model's id and drops the tip.
    expect(stripSkippedDayTips({ ...missingDayPlan, prepTips: delta }).prepTips).toEqual([]);

    const remapped = remapTipRefs(delta, new Map([["wed-dinner", GEN]]));
    expect(stripSkippedDayTips({ ...missingDayPlan, prepTips: remapped }).prepTips).toEqual([
      { ...delta[0], referenced_meal_ids: [GEN] },
    ]);
    expect(delta[0].referenced_meal_ids).toEqual(["wed-dinner"]); // input untouched
  });

  it("returns ref-less tips unchanged and passes unknown ids through", () => {
    const refless: PrepTip = { day: "Monday", tip: "Wipe the counters." };
    const mixed: PrepTip = { day: "Sunday", tip: "Cook the rice.", referenced_meal_ids: ["wed-dinner", "client-uuid"] };

    expect(remapTipRefs([refless, mixed], new Map([["wed-dinner", GEN]]))).toEqual([
      refless,
      { ...mixed, referenced_meal_ids: [GEN, "client-uuid"] },
    ]);
  });
});
