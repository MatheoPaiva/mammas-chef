import { describe, expect, it } from "vitest";

import {
  normalizeMealPlan,
  parseDayRegenerationResponse,
  parseMealPlanResponse,
  parseSwapResponse,
} from "@/lib/mealPlanParser";
import { validateMealPlanDependencies } from "@/lib/mealPlanValidation";
import { applyLeftoverCascade } from "@/lib/leftoverCascade";
import type { MealPlanResponse, MealRecipe } from "@/types/mealPlan";

/** Builds a minimal single-meal, single-day plan wrapping the given raw meal
 * fields, then runs it through parseMealPlanResponse to exercise the real
 * normalizeMeal() defaulting path (mirrors the makeMeal/validPlan fixture style
 * already used in this file). */
function planWithRawMeal(rawMeal: Record<string, unknown>): MealPlanResponse {
  return parseMealPlanResponse(
    JSON.stringify({
      weekPlan: {
        title: "Status Fields Week",
        days: [
          {
            day: "Monday",
            meals: [
              {
                id: "m-mon-dinner",
                title: "Base Meal",
                mealType: "dinner",
                prepTime: "20 min",
                servings: 4,
                calories: 500,
                protein: 30,
                carbs: 40,
                fats: 18,
                tags: [],
                ingredients: [],
                steps: [],
                ...rawMeal,
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    }),
  );
}

const validPlan = {
  weekPlan: {
    title: "Test Week",
    // Canonical post-Phase-11 shape: normalizeMealPlan now populates batchCookDay
    // (edge-authoritative here; getBatchCookDay("Monday") would also derive "Sunday").
    batchCookDay: "Sunday",
    days: [
      {
        day: "Monday",
        meals: [],
      },
    ],
    // Canonical post-Phase-17 shape: normalizeMealPlan hard-defaults batches to []
    // (D-05) — included here so the round-trip toEqual() assertions below stay exact.
    batches: [],
  },
  shoppingList: [],
  prepTips: [{ day: "Sunday", tip: "Batch cook grains for the week" }],
};

/** Minimal type-valid MealRecipe for fixtures (mirrors prepTimeSavings.test.ts style). */
function makeMeal(id: string): MealRecipe {
  return {
    id,
    title: "Tacos",
    mealType: "dinner",
    prepTime: "30 min",
    servings: 4,
    calories: 500,
    protein: 30,
    carbs: 40,
    fats: 18,
    tags: [],
    ingredients: [],
    steps: [],
  };
}

describe("normalizeMeal — Phase 15 status/card field defaulting", () => {
  it("keeps a valid status 'prep-linked' unchanged", () => {
    const parsed = planWithRawMeal({ status: "prep-linked" });
    expect(parsed.weekPlan.days[0].meals[0].status).toBe("prep-linked");
  });

  it("whitelist-rejects an invalid status ('banana') to undefined, no throw", () => {
    const parsed = planWithRawMeal({ status: "banana" });
    expect(parsed.weekPlan.days[0].meals[0].status).toBeUndefined();
  });

  it("defaults status to undefined when null/missing", () => {
    const parsedNull = planWithRawMeal({ status: null });
    expect(parsedNull.weekPlan.days[0].meals[0].status).toBeUndefined();

    const parsedMissing = planWithRawMeal({});
    expect(parsedMissing.weekPlan.days[0].meals[0].status).toBeUndefined();
  });

  it("preserves non-empty string values for cautionNote/workflow/storage/cookTime/totalTime", () => {
    const parsed = planWithRawMeal({
      cautionNote: "High sodium — not toddler-suitable",
      workflow: "Cook fresh. No prep dependency.",
      storage: "Refrigerate up to 4 days.",
      cookTime: "25 min",
      totalTime: "45 min",
    });
    const meal = parsed.weekPlan.days[0].meals[0];
    expect(meal.cautionNote).toBe("High sodium — not toddler-suitable");
    expect(meal.workflow).toBe("Cook fresh. No prep dependency.");
    expect(meal.storage).toBe("Refrigerate up to 4 days.");
    expect(meal.cookTime).toBe("25 min");
    expect(meal.totalTime).toBe("45 min");
  });

  it("defaults cautionNote/workflow/storage/cookTime/totalTime to undefined when empty-string or missing", () => {
    const parsedEmpty = planWithRawMeal({
      cautionNote: "",
      workflow: "",
      storage: "",
      cookTime: "",
      totalTime: "",
    });
    const emptyMeal = parsedEmpty.weekPlan.days[0].meals[0];
    expect(emptyMeal.cautionNote).toBeUndefined();
    expect(emptyMeal.workflow).toBeUndefined();
    expect(emptyMeal.storage).toBeUndefined();
    expect(emptyMeal.cookTime).toBeUndefined();
    expect(emptyMeal.totalTime).toBeUndefined();

    const parsedMissing = planWithRawMeal({});
    const missingMeal = parsedMissing.weekPlan.days[0].meals[0];
    expect(missingMeal.cautionNote).toBeUndefined();
    expect(missingMeal.workflow).toBeUndefined();
    expect(missingMeal.storage).toBeUndefined();
    expect(missingMeal.cookTime).toBeUndefined();
    expect(missingMeal.totalTime).toBeUndefined();
  });

  it("normalizes a legacy meal (none of the 6 fields present) with all 6 as undefined, no error", () => {
    let parsed: MealPlanResponse | undefined;
    expect(() => {
      parsed = planWithRawMeal({});
    }).not.toThrow();
    const meal = parsed!.weekPlan.days[0].meals[0];
    expect(meal.status).toBeUndefined();
    expect(meal.cautionNote).toBeUndefined();
    expect(meal.workflow).toBeUndefined();
    expect(meal.storage).toBeUndefined();
    expect(meal.cookTime).toBeUndefined();
    expect(meal.totalTime).toBeUndefined();
  });
});

describe("normalizeMeal — Phase 17 batch model (uses/creates whitelist, D-04)", () => {
  it("round-trips a meal with uses:[\"Q1\",\"T1\"] and creates:\"S1\" unchanged", () => {
    const parsed = planWithRawMeal({ uses: ["Q1", "T1"], creates: "S1" });
    const meal = parsed.weekPlan.days[0].meals[0];
    expect(meal.uses).toEqual(["Q1", "T1"]);
    expect(meal.creates).toBe("S1");
  });

  it("whitelist-rejects a non-array uses and a non-string creates without throwing", () => {
    let parsed: MealPlanResponse | undefined;
    expect(() => {
      parsed = planWithRawMeal({ uses: "notarray", creates: 42 });
    }).not.toThrow();
    const meal = parsed!.weekPlan.days[0].meals[0];
    expect(meal.uses).toEqual([]);
    expect(meal.creates).toBeUndefined();
  });

  it("filters non-string entries out of a uses array", () => {
    const parsed = planWithRawMeal({ uses: ["Q1", 42, null, "T1"] });
    const meal = parsed.weekPlan.days[0].meals[0];
    expect(meal.uses).toEqual(["Q1", "T1"]);
  });

  it("defaults uses to [] and creates to undefined when both absent (legacy meal)", () => {
    const parsed = planWithRawMeal({});
    const meal = parsed.weekPlan.days[0].meals[0];
    expect(meal.uses).toEqual([]);
    expect(meal.creates).toBeUndefined();
  });

  it("defaults creates to undefined when null", () => {
    const parsed = planWithRawMeal({ creates: null });
    const meal = parsed.weekPlan.days[0].meals[0];
    expect(meal.creates).toBeUndefined();
  });
});

describe("normalizeMealPlan — Phase 17 batches default (D-05)", () => {
  it("defaults weekPlan.batches to [] when absent on a legacy plan", () => {
    const legacy: MealPlanResponse = {
      weekPlan: { title: "Legacy Week", days: [{ day: "Monday", meals: [makeMeal("m1")] }] },
      shoppingList: [],
      prepTips: [],
    };
    const normalized = normalizeMealPlan(legacy);
    expect(normalized.weekPlan.batches).toEqual([]);
  });

  it("preserves an existing batches array unchanged", () => {
    const withBatches: MealPlanResponse = {
      weekPlan: {
        title: "Batch Week",
        days: [{ day: "Monday", meals: [makeMeal("m1")] }],
        batches: [
          { id: "Q1", task: "Cook quinoa", yield: "3 cups", storage: "Fridge", useBy: "Thursday", time: "~15 min" },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };
    const normalized = normalizeMealPlan(withBatches);
    expect(normalized.weekPlan.batches).toHaveLength(1);
    expect(normalized.weekPlan.batches?.[0].id).toBe("Q1");
  });

  it("defaults batches to [] when the raw value is not an array (whitelist)", () => {
    const malformed = {
      weekPlan: {
        title: "Malformed Batches Week",
        days: [{ day: "Monday", meals: [makeMeal("m1")] }],
        batches: "not-an-array",
      },
      shoppingList: [],
      prepTips: [],
    } as unknown as MealPlanResponse;
    const normalized = normalizeMealPlan(malformed);
    expect(normalized.weekPlan.batches).toEqual([]);
  });
});

describe("normalizeMealPlan — phantom leftover repair (LEFTOVER_PHANTOM_MEAL)", () => {
  it("strips a leftover tag + dangling source_meal_id from a day-0 meal with no resolving source, making the plan valid", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Phantom Week",
        days: [
          {
            day: "Sunday", // day 0 — a leftover here is physically impossible
            meals: [
              {
                ...makeMeal("m-sun-lunch"),
                mealType: "lunch",
                title: "Italian Beef & Mushroom Ragu Pasta Bowl",
                tags: ["Italian", "Leftover", "High Protein"],
                // no source_meal_id — this is the phantom the AI emits
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    // Pre-repair the raw plan trips the validator (proves the repair is what fixes it).
    expect(validateMealPlanDependencies(plan).valid).toBe(false);

    const normalized = normalizeMealPlan(plan);
    const meal = normalized.weekPlan.days[0].meals[0];

    expect(meal.tags).toEqual(["Italian", "High Protein"]);
    expect(meal.source_meal_id).toBeUndefined();
    expect(validateMealPlanDependencies(normalized).valid).toBe(true);
  });

  it("also strips a 'Reheat' tag with no resolving source", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Reheat Week",
        days: [
          {
            day: "Monday",
            meals: [
              {
                ...makeMeal("m-mon-dinner"),
                mealType: "dinner",
                tags: ["Reheat", "Comfort"],
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(plan);
    const meal = normalized.weekPlan.days[0].meals[0];

    expect(meal.tags).toEqual(["Comfort"]);
    expect(meal.source_meal_id).toBeUndefined();
    expect(validateMealPlanDependencies(normalized).valid).toBe(true);
  });

  it("preserves a legitimate leftover (tag + resolving earlier source_meal_id)", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Legit Week",
        days: [
          {
            day: "Monday",
            meals: [
              { ...makeMeal("m-mon-dinner"), mealType: "dinner", title: "Roast Chicken", tags: ["Mediterranean"] },
            ],
          },
          {
            day: "Tuesday",
            meals: [
              {
                ...makeMeal("m-tue-lunch"),
                mealType: "lunch",
                title: "Chicken Bowl",
                tags: ["Leftover"],
                source_meal_id: "m-mon-dinner", // resolves to an earlier real meal
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(plan);
    const leftover = normalized.weekPlan.days[1].meals[0];

    expect(leftover.tags).toContain("Leftover");
    expect(leftover.source_meal_id).toBe("m-mon-dinner");
    expect(validateMealPlanDependencies(normalized).valid).toBe(true);
  });

  it("repairs a phantom by re-linking to an earlier-slot meal that restates the title (Sentry 7517613221)", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Re-link Week",
        days: [
          {
            day: "Wednesday",
            meals: [
              {
                ...makeMeal("m-wed-dinner"),
                mealType: "dinner",
                title: "Mediterranean Chicken & Roasted Veggie Bowl",
                tags: ["Mediterranean"],
              },
            ],
          },
          {
            day: "Friday",
            meals: [
              {
                ...makeMeal("m-fri-lunch"),
                mealType: "lunch",
                // The leftover restates the source's title, but the AI emitted a bogus source.
                title: "Mediterranean Chicken & Roasted Veggie Bowl",
                tags: ["Leftover", "Mediterranean"],
                source_meal_id: "does-not-exist",
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    // The raw phantom trips the validator; the repair is what fixes it.
    expect(validateMealPlanDependencies(plan).valid).toBe(false);

    const normalized = normalizeMealPlan(plan);
    const leftover = normalized.weekPlan.days[1].meals[0];

    expect(leftover.tags).toContain("Leftover"); // tag KEPT — this is a real leftover
    expect(leftover.source_meal_id).toBe("m-wed-dinner"); // re-linked to the earlier source
    expect(validateMealPlanDependencies(normalized).valid).toBe(true);
  });

  it("matches titles case/punctuation/&-vs-and-insensitively when re-linking", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Normalize Week",
        days: [
          {
            day: "Monday",
            meals: [
              { ...makeMeal("m-mon-dinner"), mealType: "dinner", title: "Mediterranean Chicken and Roasted Veggie Bowl", tags: ["Mediterranean"] },
            ],
          },
          {
            day: "Thursday",
            meals: [
              {
                ...makeMeal("m-thu-lunch"),
                mealType: "lunch",
                title: "  MEDITERRANEAN CHICKEN & ROASTED VEGGIE BOWL!  ",
                tags: ["Leftovers"],
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(plan);
    const leftover = normalized.weekPlan.days[1].meals[0];

    expect(leftover.source_meal_id).toBe("m-mon-dinner");
    expect(leftover.tags).toContain("Leftovers");
    expect(validateMealPlanDependencies(normalized).valid).toBe(true);
  });

  it("links to the NEAREST earlier slot when multiple earlier meals share the title", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Tie Week",
        days: [
          { day: "Monday", meals: [{ ...makeMeal("m-mon-bfast"), mealType: "breakfast", title: "Overnight Oats", tags: [] }] },
          { day: "Wednesday", meals: [{ ...makeMeal("m-wed-bfast"), mealType: "breakfast", title: "Overnight Oats", tags: [] }] },
          { day: "Friday", meals: [{ ...makeMeal("m-fri-bfast"), mealType: "breakfast", title: "Overnight Oats", tags: ["Leftover"] }] },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(plan);
    const leftover = normalized.weekPlan.days[2].meals[0];

    expect(leftover.source_meal_id).toBe("m-wed-bfast"); // nearest earlier, not m-mon-bfast
    expect(leftover.tags).toContain("Leftover");
    expect(validateMealPlanDependencies(normalized).valid).toBe(true);
  });

  it("does NOT link to a same-title meal in a later slot — strips instead (earlier-slot only)", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Later Week",
        days: [
          { day: "Monday", meals: [{ ...makeMeal("m-mon-dinner"), mealType: "dinner", title: "Beef Stew", tags: ["Leftover"] }] },
          { day: "Wednesday", meals: [{ ...makeMeal("m-wed-dinner"), mealType: "dinner", title: "Beef Stew", tags: [] }] },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(plan);
    const phantom = normalized.weekPlan.days[0].meals[0];

    expect(phantom.tags).not.toContain("Leftover"); // no earlier match → stripped
    expect(phantom.source_meal_id).toBeUndefined();
    expect(validateMealPlanDependencies(normalized).valid).toBe(true);
  });

  it("never block-saves: an empty-title phantom strips cleanly without throwing", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Empty Title Week",
        days: [
          { day: "Monday", meals: [{ ...makeMeal("m-mon-dinner"), mealType: "dinner", title: "", tags: ["Reheat"] }] },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    let normalized: MealPlanResponse;
    expect(() => { normalized = normalizeMealPlan(plan); }).not.toThrow();
    const phantom = normalized!.weekPlan.days[0].meals[0];
    expect(phantom.tags).not.toContain("Reheat");
    expect(phantom.source_meal_id).toBeUndefined();
    expect(validateMealPlanDependencies(normalized!).valid).toBe(true);
  });

  it("Phase 15 dual-signal: resets a phantom status:'leftover' (no tag, no resolving source) to 'fresh' on a day-0 meal", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Status Phantom Week",
        days: [
          {
            day: "Sunday", // day 0 — a leftover here is physically impossible
            meals: [
              {
                ...makeMeal("m-sun-lunch"),
                mealType: "lunch",
                title: "Italian Beef & Mushroom Ragu Pasta Bowl",
                tags: [], // no leftover tag — status is the only signal
                status: "leftover",
                // no source_meal_id — this is the phantom the AI emits
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    // Pre-repair the raw plan trips the validator via the status-only signal.
    expect(validateMealPlanDependencies(plan).valid).toBe(false);

    const normalized = normalizeMealPlan(plan);
    const meal = normalized.weekPlan.days[0].meals[0];

    expect(meal.status).toBe("fresh");
    expect(meal.source_meal_id).toBeUndefined();
    expect(validateMealPlanDependencies(normalized).valid).toBe(true);
  });

  it("Phase 15 dual-signal: re-links a status-only phantom to its earlier-slot title match and keeps status 'leftover'", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Status Re-link Week",
        days: [
          {
            day: "Wednesday",
            meals: [
              {
                ...makeMeal("m-wed-dinner"),
                mealType: "dinner",
                title: "Mediterranean Chicken & Roasted Veggie Bowl",
                tags: [],
              },
            ],
          },
          {
            day: "Friday",
            meals: [
              {
                ...makeMeal("m-fri-lunch"),
                mealType: "lunch",
                title: "Mediterranean Chicken & Roasted Veggie Bowl",
                tags: [], // no leftover tag — status is the only signal
                status: "leftover",
                source_meal_id: "does-not-exist",
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(plan);
    const leftover = normalized.weekPlan.days[1].meals[0];

    expect(leftover.status).toBe("leftover");
    expect(leftover.source_meal_id).toBe("m-wed-dinner"); // re-linked to the earlier source
    expect(validateMealPlanDependencies(normalized).valid).toBe(true);
  });

  it("Phase 17 D-23: strip path clears uses on a stripped phantom leftover", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Batch Phantom Week",
        days: [
          {
            day: "Sunday", // day 0 — a leftover here is physically impossible, no earlier match exists
            meals: [
              {
                ...makeMeal("m-sun-lunch"),
                mealType: "lunch",
                title: "Unique Batch Strip Test Title",
                tags: ["Leftover"],
                uses: ["Q1"],
                // no source_meal_id — this is the phantom the AI emits
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(plan);
    const meal = normalized.weekPlan.days[0].meals[0];

    expect(meal.tags).not.toContain("Leftover");
    expect(meal.source_meal_id).toBeUndefined();
    expect(meal.uses).toBeUndefined();
  });

  it("Phase 17 D-23: re-link path leaves uses untouched (successful repair preserves batch refs)", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Batch Re-link Week",
        days: [
          {
            day: "Wednesday",
            meals: [
              { ...makeMeal("m-wed-dinner"), mealType: "dinner", title: "Batch Source Meal Title", tags: [] },
            ],
          },
          {
            day: "Friday",
            meals: [
              {
                ...makeMeal("m-fri-lunch"),
                mealType: "lunch",
                title: "Batch Source Meal Title",
                tags: ["Leftover"],
                source_meal_id: "does-not-exist",
                uses: ["Q1"],
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(plan);
    const leftover = normalized.weekPlan.days[1].meals[0];

    expect(leftover.source_meal_id).toBe("m-wed-dinner"); // re-linked, not stripped
    expect(leftover.uses).toEqual(["Q1"]); // preserved — re-link path never clears uses
  });

  it("leftover-swap-cascade fix: keeps uses/status when the referenced batch id is real, even with a dangling source_meal_id and no title match (real save/load round-trip shape)", () => {
    // Mirrors the actual prod data shape (evidence: plan 1d3dbdd6-8bc4-426b-8d0c-53e82fc8c42c):
    // DB-UUID meal ids, a stale AI-era mnemonic source_meal_id that resolves to
    // nothing post-load, a batches[] entry that DOES still exist, and a title
    // that no longer matches any earlier-slot meal (titles differ day to day).
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Round-Trip Week",
        batches: [
          { id: "S1", task: "Cook and portion salmon.", yield: "4 servings", storage: null, useBy: null, time: null },
        ],
        days: [
          {
            day: "Tuesday",
            meals: [
              { ...makeMeal("662ee50a-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), mealType: "dinner", title: "Herb-Crusted Salmon", tags: [], creates: "S1" },
            ],
          },
          {
            day: "Thursday",
            meals: [
              {
                ...makeMeal("772ee50a-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
                mealType: "dinner",
                title: "Leftover Herb-Crusted Salmon", // "Leftover " prefix means normalizeTitle never matches the source title
                tags: ["Leftover"],
                status: "leftover",
                source_meal_id: "tue-dinner", // stale AI-era mnemonic — does not resolve to a DB UUID
                uses: ["S1"],
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(plan);
    const dependent = normalized.weekPlan.days[1].meals[0];

    // Root-cause chain link 2 fix: the batch reference is independently
    // verifiable (S1 exists in batches[]), so uses/status/tags survive even
    // though source_meal_id never resolved.
    expect(dependent.uses).toEqual(["S1"]);
    expect(dependent.status).toBe("leftover");
    expect(dependent.tags).toContain("Leftover");

    // And the cascade actually fires on this exact shape when the source is swapped.
    const oldMeal = normalized.weekPlan.days[0].meals[0];
    const newMeal: MealRecipe = { ...makeMeal(oldMeal.id), mealType: "dinner", title: "Lemon Herb Chicken", creates: "S1" };
    const updatedDays = normalized.weekPlan.days.map((d, i) => (i === 0 ? { ...d, meals: [newMeal] } : d));
    const cascadeResult = applyLeftoverCascade({ ...normalized.weekPlan, days: updatedDays }, oldMeal, newMeal);

    expect(cascadeResult.toastDescriptionSuffix).toBe("Thursday dinner updated to leftover Lemon Herb Chicken.");
    expect(cascadeResult.weekPlan.days[1].meals[0].title).toBe("Leftover Lemon Herb Chicken");
  });

  it("Phase 15 dual-signal: a leftover TAG with no status is still repaired unchanged (existing tag behavior)", () => {
    const plan: MealPlanResponse = {
      weekPlan: {
        title: "Tag-Only Week",
        days: [
          {
            day: "Monday",
            meals: [
              { ...makeMeal("m-mon-dinner"), mealType: "dinner", tags: ["Reheat"] }, // no status field at all
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(plan);
    const meal = normalized.weekPlan.days[0].meals[0];

    expect(meal.tags).not.toContain("Reheat");
    expect(meal.source_meal_id).toBeUndefined();
    expect(meal.status).toBeUndefined(); // untouched — was never set
    expect(validateMealPlanDependencies(normalized).valid).toBe(true);
  });
});

describe("parseMealPlanResponse", () => {
  it("parses plain JSON", () => {
    expect(parseMealPlanResponse(JSON.stringify(validPlan))).toEqual(validPlan);
  });

  it("parses fenced JSON", () => {
    const response = `\`\`\`json
${JSON.stringify(validPlan, null, 2)}
\`\`\``;

    expect(parseMealPlanResponse(response)).toEqual(validPlan);
  });

  it("parses JSON surrounded by extra model text", () => {
    const response = `Here is your plan:

${JSON.stringify(validPlan, null, 2)}

Enjoy your week!`;

    expect(parseMealPlanResponse(response)).toEqual(validPlan);
  });

  it("preserves canonical library recipe ids from generated meals", () => {
    const planWithLibraryRecipe = {
      ...validPlan,
      weekPlan: {
        title: "Library Week",
        days: [
          {
            day: "Monday",
            meals: [
              {
                id: "generated-slot-1",
                libraryRecipeId: "canonical-recipe-1",
                title: "Lemony Chickpea Bowls",
                mealType: "lunch",
                prepTime: "15 min",
                servings: 4,
                calories: 430,
                protein: 18,
                carbs: 52,
                fats: 16,
                tags: ["vegetarian"],
                ingredients: [{ name: "chickpeas", quantity: 2, unit: "can" }],
                steps: ["Warm chickpeas and assemble bowls."],
              },
            ],
          },
        ],
      },
    };

    const parsed = parseMealPlanResponse(JSON.stringify(planWithLibraryRecipe));

    expect(parsed.weekPlan.days[0].meals[0].libraryRecipeId).toBe("canonical-recipe-1");
  });

  it("throws when no meal plan JSON exists", () => {
    expect(() => parseMealPlanResponse("not json")).toThrow("Unable to parse meal plan response");
  });

  it("G-04: strips hallucinated leftover provenance from titles, steps, ingredients", () => {
    const planWithGhosts = {
      weekPlan: {
        title: "Ghost Week",
        days: [
          {
            day: "Wednesday",
            meals: [
              {
                id: "wed-lunch",
                title: "Creamy Tomato & Feta Baked Orzo (from Friday Dinner)",
                mealType: "lunch",
                prepTime: "10 min",
                servings: 2,
                calories: 400,
                protein: 18,
                carbs: 50,
                fats: 12,
                tags: [],
                ingredients: [
                  { name: "Reheated orzo, from Monday dinner", quantity: 1, unit: "serving" },
                  { name: "arugula", quantity: 0.5, unit: "cup" },
                ],
                steps: [
                  "Reheat the orzo gently.",
                  "Portion half (3 servings) into an airtight container and refrigerate for Friday lunch.",
                  "Top with arugula and serve.",
                ],
              },
            ],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const parsed = parseMealPlanResponse(JSON.stringify(planWithGhosts));
    const meal = parsed.weekPlan.days[0].meals[0];

    expect(meal.title).toBe("Creamy Tomato & Feta Baked Orzo");
    expect(meal.ingredients[0].name).toBe("Reheated orzo");
    expect(meal.steps).toEqual([
      "Reheat the orzo gently.",
      "Top with arugula and serve.",
    ]);
  });
});

describe("normalizeMealPlan re-tag", () => {
  // Mis-tag fixture: AI tagged prep tasks to "Monday" (first plan day) instead of
  // "Sunday" (the batchCookDay) — the exact failure mode from Kristina's plan
  // f3409e16-... (11-CONTEXT.md specifics). D-08 guards the real bug, not the happy path.
  const mistagged: MealPlanResponse = {
    weekPlan: {
      title: "Mexican Week",
      batchCookDay: "Sunday",
      days: [{ day: "Monday", meals: [makeMeal("m1")] }],
    },
    shoppingList: [],
    prepTips: [
      { id: "tip-prep-1", day: "Monday", tip: "Roast chicken for the week (~30 min)." },
      { id: "tip-prep-2", day: "Monday", tip: "Cook rice and portion for 4 days (~20 min)." },
      { id: "tip-monday-night", day: "Monday", tip: "Set out Tuesday breakfast ingredients." },
    ],
  };

  it("re-tags prep-day tips to batchCookDay when AI mis-tagged them to day-1", () => {
    const normalized = normalizeMealPlan(mistagged);

    // (1) D-08 core: tips on the labeled prep day are non-empty after normalization
    expect(normalized.prepTips.filter((t) => t.day === "Sunday").length).toBeGreaterThanOrEqual(2);
    // (2) the nightly tip is NOT re-tagged — it stays on its own day
    expect(normalized.prepTips.find((t) => t.id === "tip-monday-night")?.day).toBe("Monday");
    // (3) no tip-prep-* task is left off the labeled prep day
    expect(
      normalized.prepTips.filter((t) => t.id?.startsWith("tip-prep-") && t.day !== "Sunday").length,
    ).toBe(0);
  });

  it("derives batchCookDay on read for legacy plans with no batchCookDay (D-07)", () => {
    const legacy: MealPlanResponse = {
      weekPlan: {
        title: "Legacy Week",
        days: [{ day: "Monday", meals: [makeMeal("m1")] }],
      },
      shoppingList: [],
      prepTips: [
        { id: "tip-prep-1", day: "Monday", tip: "Batch cook grains (~20 min)." },
        { id: "tip-prep-2", day: "Monday", tip: "Chop vegetables (~15 min)." },
      ],
    };

    const normalized = normalizeMealPlan(legacy);

    // getBatchCookDay("Monday") === "Sunday"
    expect(normalized.weekPlan.batchCookDay).toBe("Sunday");
    expect(normalized.prepTips.filter((t) => t.day === "Sunday").length).toBeGreaterThan(0);
  });

  it("re-tags the dominant tip cluster when no tip-prep- ids are present, and leaves below-threshold clusters alone", () => {
    // Dominant cluster: 3 tips on "Tuesday" (no prep ids) re-tag to batchCookDay "Sunday".
    const dominant: MealPlanResponse = {
      weekPlan: {
        title: "Cluster Week",
        batchCookDay: "Sunday",
        days: [{ day: "Monday", meals: [makeMeal("m1")] }],
      },
      shoppingList: [],
      prepTips: [
        { day: "Tuesday", tip: "a" },
        { day: "Tuesday", tip: "b" },
        { day: "Tuesday", tip: "c" },
        { day: "Wednesday", tip: "d" },
      ],
    };
    const normalizedDominant = normalizeMealPlan(dominant);
    expect(normalizedDominant.prepTips.filter((t) => t.day === "Sunday").length).toBe(3);

    // Below threshold: only 2 tips on "Tuesday" (no prep ids) → left unchanged.
    const belowThreshold: MealPlanResponse = {
      weekPlan: {
        title: "Sparse Week",
        batchCookDay: "Sunday",
        days: [{ day: "Monday", meals: [makeMeal("m1")] }],
      },
      shoppingList: [],
      prepTips: [
        { day: "Tuesday", tip: "a" },
        { day: "Tuesday", tip: "b" },
      ],
    };
    const normalizedBelow = normalizeMealPlan(belowThreshold);
    expect(normalizedBelow.prepTips.filter((t) => t.day === "Sunday").length).toBe(0);
    expect(normalizedBelow.prepTips.filter((t) => t.day === "Tuesday").length).toBe(2);
  });

  it("is idempotent — normalizing twice yields the same result", () => {
    const once = normalizeMealPlan(mistagged);
    const twice = normalizeMealPlan(once);
    expect(twice).toEqual(once);
  });

  it("WR-01: rejects a non-weekday batchCookDay and derives instead", () => {
    const garbage: MealPlanResponse = {
      weekPlan: {
        title: "Garbage Week",
        // "Funday" is not in ALL_WEEKDAYS → must be ignored, derive from days[0].
        batchCookDay: "Funday",
        days: [{ day: "Monday", meals: [makeMeal("m1")] }],
      },
      shoppingList: [],
      prepTips: [
        { id: "tip-prep-1", day: "Monday", tip: "Batch cook (~20 min)." },
        { id: "tip-prep-2", day: "Monday", tip: "Chop (~15 min)." },
      ],
    };

    const normalized = normalizeMealPlan(garbage);

    // getBatchCookDay("Monday") === "Sunday" — the garbage value never wins.
    expect(normalized.weekPlan.batchCookDay).toBe("Sunday");
    expect(normalized.prepTips.filter((t) => t.day === "Sunday").length).toBeGreaterThan(0);
  });

  it("WR-01: rejects a whitespace batchCookDay and derives instead", () => {
    const whitespace: MealPlanResponse = {
      weekPlan: {
        title: "Whitespace Week",
        batchCookDay: " ",
        days: [{ day: "Monday", meals: [makeMeal("m1")] }],
      },
      shoppingList: [],
      prepTips: [],
    };

    expect(normalizeMealPlan(whitespace).weekPlan.batchCookDay).toBe("Sunday");
  });

  it("WR-02: derives from explicit weekStartDay over positional days[0]", () => {
    // days[0] is "Wednesday" (e.g. the load path returns days in DB order),
    // but the plan's true week-start is "Monday" → prep day must be "Sunday",
    // NOT getBatchCookDay("Wednesday") === "Tuesday".
    const reordered: MealPlanResponse = {
      weekPlan: {
        title: "Reordered Week",
        days: [{ day: "Wednesday", meals: [makeMeal("m1")] }],
      },
      shoppingList: [],
      prepTips: [],
    };

    expect(normalizeMealPlan(reordered, "Monday").weekPlan.batchCookDay).toBe("Sunday");
    // Without the hint, the legacy positional fallback derives from "Wednesday".
    expect(normalizeMealPlan(reordered).weekPlan.batchCookDay).toBe("Tuesday");
  });

  it("WR-01: a valid edge batchCookDay still wins over the weekStartDay hint", () => {
    // Edge-authoritative value is a real weekday → trusted verbatim even when a
    // hint is also supplied (D-02 — the edge stays the source of truth when valid).
    const valid: MealPlanResponse = {
      weekPlan: {
        title: "Valid Edge Week",
        batchCookDay: "Saturday",
        days: [{ day: "Wednesday", meals: [makeMeal("m1")] }],
      },
      shoppingList: [],
      prepTips: [],
    };

    expect(normalizeMealPlan(valid, "Monday").weekPlan.batchCookDay).toBe("Saturday");
  });

  it("WR-03: does not throw on a null prepTips element and re-tags the valid tip", () => {
    // The generation path can emit a null element; dereferencing t.id used to
    // throw a TypeError and fail the entire parse. The bad element is dropped.
    const withNull = {
      weekPlan: {
        title: "Null-Tip Week",
        batchCookDay: "Sunday",
        days: [{ day: "Monday", meals: [makeMeal("m1")] }],
      },
      shoppingList: [],
      prepTips: [null, { id: "tip-prep-1", day: "Monday", tip: "Roast (~30 min)." }],
    } as unknown as MealPlanResponse;

    let normalized: MealPlanResponse;
    expect(() => {
      normalized = normalizeMealPlan(withNull);
    }).not.toThrow();

    expect(normalized!.prepTips.some((t) => t === null)).toBe(false);
    expect(normalized!.prepTips.filter((t) => t.day === "Sunday").length).toBe(1);
  });

  it("WR-03: drops a non-object (string) prepTips element without throwing", () => {
    const withString = {
      weekPlan: {
        title: "String-Tip Week",
        batchCookDay: "Sunday",
        days: [{ day: "Monday", meals: [makeMeal("m1")] }],
      },
      shoppingList: [],
      prepTips: ["just a string", { day: "Monday", tip: "y" }],
    } as unknown as MealPlanResponse;

    let normalized: MealPlanResponse;
    expect(() => {
      normalized = normalizeMealPlan(withString);
    }).not.toThrow();

    // Only the well-formed object survives the filter.
    expect(normalized!.prepTips.length).toBe(1);
    expect(normalized!.prepTips.every((t) => typeof t === "object")).toBe(true);
  });
});

describe("normalizeMeal — NUTR-02 contradictory nutrition tag strip (D-06/D-07)", () => {
  it("drops a Low Carb tag when carbs exceed the shared threshold (36g > 35g), Mediterranean survives", () => {
    const parsed = planWithRawMeal({ tags: ["Low Carb", "Mediterranean"], carbs: 36 });
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual(["Mediterranean"]);
  });

  it("keeps a Low Carb tag exactly at the threshold (35g, not over — matches dietary_preference_mismatch's > 35)", () => {
    const parsed = planWithRawMeal({ tags: ["Low Carb"], carbs: 35 });
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual(["Low Carb"]);
  });

  it("keeps a consistent Low Carb tag well under threshold (carbs 30)", () => {
    const parsed = planWithRawMeal({ tags: ["Low Carb"], carbs: 30 });
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual(["Low Carb"]);
  });

  it("drops a Keto tag when carbs exceed 20g (carbs 21)", () => {
    const parsed = planWithRawMeal({ tags: ["Keto"], carbs: 21 });
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual([]);
  });

  it("keeps a Keto tag exactly at the threshold (carbs 20, not over)", () => {
    const parsed = planWithRawMeal({ tags: ["Keto"], carbs: 20 });
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual(["Keto"]);
  });

  it("drops a High Protein tag when protein is below the floor (protein 8 < 10)", () => {
    const parsed = planWithRawMeal({ tags: ["High Protein"], protein: 8 });
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual([]);
  });

  it("keeps a High Protein tag exactly at the threshold (protein 10, not under)", () => {
    const parsed = planWithRawMeal({ tags: ["High Protein"], protein: 10 });
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual(["High Protein"]);
  });

  it("never touches uncheckable/non-nutrition tags regardless of macros (High Fiber, Toddler-Friendly, Mediterranean)", () => {
    const parsed = planWithRawMeal({
      tags: ["High Fiber", "Toddler-Friendly", "Mediterranean"],
      carbs: 999,
      protein: 0,
    });
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual([
      "High Fiber",
      "Toddler-Friendly",
      "Mediterranean",
    ]);
  });

  it("normalizes tags case/hyphen/space-insensitively before matching (LOW-CARB, keto, High  Protein all contradict)", () => {
    const parsed = planWithRawMeal({ tags: ["LOW-CARB", "keto ", " High  Protein"], carbs: 40, protein: 5 });
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual([]);
  });

  it("a legacy meal with no tags key normalizes to an empty tags array (unchanged behavior)", () => {
    const parsed = planWithRawMeal({});
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual([]);
  });

  it("round-trip: a saved plan re-parsed through normalizeMealPlan drops the contradictory tag while a clean tag on the same meal remains", () => {
    const saved: MealPlanResponse = {
      weekPlan: {
        title: "Saved Plan Week",
        days: [
          {
            day: "Monday",
            meals: [{ ...makeMeal("m-mon-dinner"), tags: ["Low Carb", "Mediterranean"], carbs: 40 }],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(saved);
    const meal = normalized.weekPlan.days[0].meals[0];
    expect(meal.tags).toEqual(["Mediterranean"]);
  });
});

describe("normalizeMeal — NUTR-02 backward-compat + regression (D-06)", () => {
  it("a plan whose meals have no tags field parses identically to before (tags: []) — legacy safety", () => {
    const legacy: MealPlanResponse = {
      weekPlan: { title: "Legacy No-Tags Week", days: [{ day: "Monday", meals: [makeMeal("m1")] }] },
      shoppingList: [],
      prepTips: [],
    };
    const normalized = normalizeMealPlan(legacy);
    expect(normalized.weekPlan.days[0].meals[0].tags).toEqual([]);

    const parsed = planWithRawMeal({});
    expect(parsed.weekPlan.days[0].meals[0].tags).toEqual([]);
  });

  it("saved-plan round-trip: a contradictory tag is absent after normalizeMealPlan while a clean tag on the same meal persists", () => {
    const saved: MealPlanResponse = {
      weekPlan: {
        title: "Round-trip Week",
        days: [
          {
            day: "Tuesday",
            meals: [{ ...makeMeal("m-tue-dinner"), tags: ["Keto", "Mediterranean"], carbs: 45 }],
          },
        ],
      },
      shoppingList: [],
      prepTips: [],
    };

    const normalized = normalizeMealPlan(saved);
    const meal = normalized.weekPlan.days[0].meals[0];
    expect(meal.tags).not.toContain("Keto");
    expect(meal.tags).toContain("Mediterranean");
  });

  it("the tag strip does not alter macros, ingredients, or steps — only tags change", () => {
    const parsed = planWithRawMeal({
      tags: ["Low Carb"],
      carbs: 50,
      protein: 22,
      calories: 480,
      fats: 15,
      ingredients: [{ name: "rice" }],
      steps: ["Cook rice.", "Serve warm."],
    });
    const meal = parsed.weekPlan.days[0].meals[0];

    expect(meal.tags).toEqual([]);
    expect(meal.carbs).toBe(50);
    expect(meal.protein).toBe(22);
    expect(meal.calories).toBe(480);
    expect(meal.fats).toBe(15);
    expect(meal.ingredients[0].name).toBe("rice");
    expect(meal.steps).toEqual(["Cook rice.", "Serve warm."]);
  });
});

describe("parseSwapResponse / parseDayRegenerationResponse — updatedPrepTips is optional (261007-slz P1)", () => {
  const rawMeal = {
    id: "m-tue-dinner",
    title: "Turkey Chili",
    mealType: "dinner",
    prepTime: "30 min",
    servings: 4,
    calories: 450,
    protein: 35,
    carbs: 40,
    fats: 15,
    tags: [],
    ingredients: [],
    steps: [],
  };
  const swap = (extra: Record<string, unknown>) =>
    parseSwapResponse(JSON.stringify({ newMeal: rawMeal, newShoppingItems: [], ...extra }));
  const regen = (extra: Record<string, unknown>) =>
    parseDayRegenerationResponse(JSON.stringify({ newMeals: [rawMeal], ...extra }));

  it("parses a swap with no updatedPrepTips and leaves it undefined (the caller keeps its current tips)", () => {
    expect(swap({}).updatedPrepTips).toBeUndefined();
  });

  it("keeps an empty merged list as []", () => {
    expect(swap({ updatedPrepTips: [] }).updatedPrepTips).toEqual([]);
    expect(regen({ updatedPrepTips: [] }).updatedPrepTips).toEqual([]);
  });

  it("filters a returned list down to well-formed tips", () => {
    const tips = [null, 7, { day: "Monday" }, { tip: "no day" }, { day: "Monday", tip: "Thaw chicken." }];
    expect(swap({ updatedPrepTips: tips }).updatedPrepTips).toEqual([{ day: "Monday", tip: "Thaw chicken." }]);
    expect(regen({ updatedPrepTips: tips }).updatedPrepTips).toEqual([{ day: "Monday", tip: "Thaw chicken." }]);
  });

  it("ignores a non-array updatedPrepTips", () => {
    expect(swap({ updatedPrepTips: "nope" }).updatedPrepTips).toBeUndefined();
    expect(regen({ updatedPrepTips: { day: "Monday" } }).updatedPrepTips).toBeUndefined();
  });

  it("parses a day regen with no updatedPrepTips but still rejects an empty newMeals", () => {
    expect(regen({}).updatedPrepTips).toBeUndefined();
    expect(() => parseDayRegenerationResponse(JSON.stringify({ newMeals: [] }))).toThrow();
  });
});
