import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contradictoryNutritionTags,
  formatViolationsForRetry,
  rotateDaysToStart,
  validateMealPlan,
  validateSwapMeal,
} from "./validation.ts";

const ORDERED_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function meal(overrides: Record<string, unknown> = {}) {
  return {
    id: "meal-1",
    title: "Lemon Chicken Bowl",
    mealType: "dinner",
    servings: 1,
    calories: 420,
    protein: 32,
    carbs: 36,
    fats: 16,
    ingredients: [
      { name: "chicken thighs" },
      { name: "cumin" },
      { name: "smoked paprika" },
      { name: "dried oregano" },
    ],
    steps: ["Season and cook the chicken."],
    flavorNotes: "Lemony, smoky, and herby.",
    ...overrides,
  };
}

function daysWith(firstMeal: ReturnType<typeof meal>) {
  return ORDERED_DAYS.map((day, index) => ({
    day,
    meals: [
      index === 0 ? firstMeal : meal({
        id: `meal-${index + 1}`,
        title: `Meal ${index + 1}`,
        carbs: 12,
        ingredients: [
          { name: "cauliflower" },
          { name: "cumin" },
          { name: "smoked paprika" },
          { name: "dried oregano" },
        ],
        toddlerTip: "Serve as mild, soft pieces.",
        glucoseTip: "Pair with greens for steadier blood sugar.",
      }),
    ],
  }));
}

Deno.test("validateMealPlan flags normal meals that do not match household size", () => {
  const result = validateMealPlan(daysWith(meal({ servings: 3 })), [], {
    orderedDays: ORDERED_DAYS,
    householdSize: 1,
  });

  assertEquals(
    result.violations.filter((violation) => violation.rule === "servings_household_mismatch").map((violation) => violation.message),
    ['"Lemon Chicken Bowl" serves 3, but the user\'s household size is 1'],
  );
});

Deno.test("validateMealPlan allows larger source recipes cooked for later leftovers", () => {
  const result = validateMealPlan(daysWith(meal({
    servings: 2,
    steps: [
      "Cook the chicken and grains.",
      "Portion half into an airtight container and refrigerate for Tuesday lunch.",
    ],
  })), [], {
    orderedDays: ORDERED_DAYS,
    householdSize: 1,
  });

  assertEquals(
    result.violations.filter((violation) => violation.rule === "servings_household_mismatch"),
    [],
  );
});

Deno.test("validateMealPlan flags dietary preference conflicts", () => {
  const result = validateMealPlan(daysWith(meal({
    title: "Chicken Rice Bowl",
    ingredients: [
      { name: "chicken thighs" },
      { name: "rice" },
      { name: "cumin" },
      { name: "smoked paprika" },
      { name: "dried oregano" },
    ],
  })), [], {
    orderedDays: ORDERED_DAYS,
    dietaryPreferences: ["Vegetarian", "Low-Carb"],
  });

  assertEquals(
    result.violations.filter((violation) => violation.rule === "dietary_preference_mismatch").map((violation) => violation.message),
    [
      '"Chicken Rice Bowl" conflicts with Vegetarian preference',
      '"Chicken Rice Bowl" has 36g carbs, which conflicts with Low-Carb preference',
    ],
  );
});

Deno.test("validateMealPlan requires toddler and glucose support when enabled", () => {
  const result = validateMealPlan(daysWith(meal({
    title: "Lemon Chicken Bowl",
    toddlerTip: "",
    glucoseTip: "",
  })), [], {
    orderedDays: ORDERED_DAYS,
    toddlerFriendly: true,
    glucoseFriendly: true,
  });

  assertEquals(
    result.violations
      .filter((violation) => violation.rule === "missing_toddler_support" || violation.rule === "missing_glucose_support")
      .map((violation) => violation.message),
    [
      '"Lemon Chicken Bowl" is missing toddler-friendly guidance',
      '"Lemon Chicken Bowl" is missing glucose-friendly guidance',
    ],
  );
});

Deno.test("validateMealPlan accepts toddler and glucose support when provided", () => {
  const result = validateMealPlan(daysWith(meal({
    toddlerTip: "Serve as mild, soft finger-food pieces.",
    glucoseTip: "Pair with extra greens for steadier blood sugar.",
  })), [], {
    orderedDays: ORDERED_DAYS,
    toddlerFriendly: true,
    glucoseFriendly: true,
  });

  assertEquals(
    result.violations.filter((violation) => violation.rule === "missing_toddler_support" || violation.rule === "missing_glucose_support"),
    [],
  );
});

Deno.test("validateMealPlan flags day_order as an error (was warning)", () => {
  // Build a 7-day plan with all unique day names but starting on Sunday when
  // ORDERED_DAYS (Monday-first) is expected. Pre-bump this was a warning that
  // never triggered the retry path; post-bump it should be an error and flip
  // result.valid to false.
  const wrongOrderDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    .map((day, i) => ({
      day,
      meals: [
        meal({
          id: `m-${i}`,
          title: `Meal ${i}`,
          carbs: 12,
          ingredients: [
            { name: "cauliflower" },
            { name: "cumin" },
            { name: "smoked paprika" },
            { name: "dried oregano" },
          ],
          toddlerTip: "Serve as mild, soft pieces.",
          glucoseTip: "Pair with greens for steadier blood sugar.",
        }),
      ],
    }));
  const result = validateMealPlan(wrongOrderDays, [], { orderedDays: ORDERED_DAYS });
  const dayOrderViolations = result.violations.filter((v) => v.rule === "day_order");
  assertEquals(dayOrderViolations.length, 1);
  assertEquals(dayOrderViolations[0].severity, "error");
  assertEquals(result.valid, false);
});

Deno.test("validateSwapMeal does not throw on schema-invalid AI meals", () => {
  const violations = validateSwapMeal({
    title: "Partial Meal",
    mealType: "dinner",
    servings: 4,
    calories: 0,
    protein: 0,
    carbs: 0,
    fats: 0,
    ingredients: undefined as unknown as Array<{ name: string }>,
    steps: undefined as unknown as string[],
  }, [], {
    householdSize: 1,
    toddlerFriendly: true,
    glucoseFriendly: true,
  });

  assertEquals(
    violations.filter((violation) => violation.severity === "error").map((violation) => violation.rule),
    [
      "nutrition_zero",
      "servings_household_mismatch",
      "missing_toddler_support",
      "missing_glucose_support",
      // steps: undefined -> 0 steps, dinner floor 4, no served-or-stored
      // finish -> both new completeness rules fire too (D-07 wiring, Task 2).
      "steps_too_few",
      "steps_no_finish",
    ],
  );
});

Deno.test("validateSwapMeal exempts a genuine leftover reheat meal from the dinner-tier floor (D-07 parity)", () => {
  const violations = validateSwapMeal({
    title: "Chicken Bake Reheat",
    mealType: "dinner",
    servings: 2,
    calories: 380,
    protein: 28,
    carbs: 30,
    fats: 12,
    ingredients: [{ name: "chicken thighs" }, { name: "rice" }],
    steps: ["Reheat in the microwave 2 minutes.", "Serve hot."],
    status: "leftover",
    source_meal_id: "meal-src",
    flavorNotes: "Smoky and warm.",
  }, [], { householdSize: 2 });

  assertEquals(violations.filter((v) => v.rule === "steps_too_few"), []);
  assertEquals(violations.filter((v) => v.rule === "steps_no_finish"), []);
});

Deno.test("validateSwapMeal flags a mid-halt fresh meal with both completeness rules (D-07 parity)", () => {
  const violations = validateSwapMeal({
    title: "Creamy Chicken Skillet",
    mealType: "dinner",
    servings: 2,
    calories: 380,
    protein: 28,
    carbs: 30,
    fats: 12,
    ingredients: [{ name: "chicken thighs" }, { name: "cream" }],
    steps: ["Sear chicken 3 min per side."],
    status: "fresh",
    flavorNotes: "Rich and savory.",
  }, [], { householdSize: 2 });

  assertEquals(violations.filter((v) => v.rule === "steps_too_few").length, 1);
  assertEquals(violations.filter((v) => v.rule === "steps_no_finish").length, 1);
});

Deno.test("validateSwapMeal flags a 1-step assembly lunch below the lunch-tier floor (D-04)", () => {
  const violations = validateSwapMeal({
    title: "Turkey Wrap",
    mealType: "lunch",
    servings: 2,
    calories: 320,
    protein: 22,
    carbs: 28,
    fats: 10,
    ingredients: [{ name: "tortilla" }, { name: "turkey slices" }],
    steps: ["Layer turkey on the tortilla and roll."],
    status: "fresh",
    flavorNotes: "Light and fresh.",
  }, [], { householdSize: 2 });

  assertEquals(violations.filter((v) => v.rule === "steps_too_few").length, 1);
});

// ---------------------------------------------------------------------------
// rotateDaysToStart tests
// ---------------------------------------------------------------------------

Deno.test("rotateDaysToStart rotates a Sunday-start week to Monday-start", () => {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    .map((day) => ({ day, meals: [{ title: `m-${day}` }] }));
  const rotated = rotateDaysToStart(days, "Monday");
  assertEquals(
    rotated?.map((d) => d.day),
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  );
  // Meals stay with their days through the rotation
  assertEquals(rotated?.[0].meals[0].title, "m-Monday");
  assertEquals(rotated?.[6].meals[0].title, "m-Sunday");
});

Deno.test("rotateDaysToStart returns input unchanged when already correct", () => {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    .map((day) => ({ day, meals: [] as Array<{ title: string }> }));
  const rotated = rotateDaysToStart(days, "Monday");
  assertEquals(rotated, days);
});

Deno.test("rotateDaysToStart returns null when a day is duplicated", () => {
  const days = ["Monday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    .map((day) => ({ day, meals: [] as Array<{ title: string }> }));
  assertEquals(rotateDaysToStart(days, "Monday"), null);
});

Deno.test("rotateDaysToStart returns null when days are not a contiguous week", () => {
  // All 7 unique day names but in an arbitrary scrambled order — not a single
  // rotation, so we fall through to the existing AI retry path.
  const days = ["Monday", "Wednesday", "Tuesday", "Friday", "Thursday", "Sunday", "Saturday"]
    .map((day) => ({ day, meals: [] as Array<{ title: string }> }));
  assertEquals(rotateDaysToStart(days, "Monday"), null);
});

Deno.test("rotateDaysToStart returns null when expectedFirstDay is not in the days", () => {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    .map((day) => ({ day, meals: [] as Array<{ title: string }> }));
  // Typo / unknown expected first day
  assertEquals(rotateDaysToStart(days, "Funday"), null);
});

Deno.test("rotateDaysToStart returns null when days.length !== 7", () => {
  const days = ["Monday", "Tuesday", "Wednesday"].map((day) => ({ day, meals: [] as Array<{ title: string }> }));
  assertEquals(rotateDaysToStart(days, "Monday"), null);
});

// ---------------------------------------------------------------------------
// leftover_chain — widened forward-ref detection (steps + title, dual pattern)
// ---------------------------------------------------------------------------

Deno.test("validateMealPlan flags forward leftover references found in steps", () => {
  // Tuesday (index 1) meal references Wednesday (index 2) in its steps.
  // Old rule 14 scanned only ingredient names → miss. New rule uses mealSearchText
  // (title+steps+ingredients) and both P1 ("reheat wednesday") and P2
  // ("wednesday's dinner") patterns → caught.
  const fwd = meal({
    title: "Reheated Bowl",
    mealType: "dinner",
    steps: ["Reheat Wednesday's dinner from the fridge and serve."],
    ingredients: [
      { name: "olive oil" },
      { name: "cumin" },
      { name: "smoked paprika" },
      { name: "dried oregano" },
    ],
  });
  const days = ORDERED_DAYS.map((day, index) => ({
    day,
    meals: [index === 1 ? fwd : meal({ id: `meal-${index + 1}`, title: `Meal ${index + 1}` })],
  }));
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });
  const chain = result.violations.filter((v) => v.rule === "leftover_chain" && v.severity === "error");
  assertEquals(chain.length >= 1, true);
});

// ---------------------------------------------------------------------------
// leftover_phantom — edge-side second defense layer (Phase 15, MEAL-01/02/03)
// Mirrors the client repairPhantomLeftovers + LEFTOVER_PHANTOM_MEAL gate
// (Plan 15-01) as an independent server-side guard.
// ---------------------------------------------------------------------------

Deno.test("validateMealPlan flags status:\"leftover\" with no source_meal_id (leftover_phantom)", () => {
  const phantom = meal({
    id: "meal-2",
    title: "Phantom Leftover Bowl",
    status: "leftover",
  });
  const days = ORDERED_DAYS.map((day, index) => ({
    day,
    meals: [index === 1 ? phantom : meal({ id: `meal-${index + 1}`, title: `Meal ${index + 1}` })],
  }));
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });
  const phantomViolations = result.violations.filter((v) => v.rule === "leftover_phantom");
  assertEquals(phantomViolations.length, 1);
  assertEquals(phantomViolations[0].severity, "error");
});

Deno.test("validateMealPlan flags status:\"leftover\" with an unresolvable source_meal_id", () => {
  const phantom = meal({
    id: "meal-2",
    title: "Phantom Leftover Bowl",
    status: "leftover",
    source_meal_id: "does-not-exist",
  });
  const days = ORDERED_DAYS.map((day, index) => ({
    day,
    meals: [index === 1 ? phantom : meal({ id: `meal-${index + 1}`, title: `Meal ${index + 1}` })],
  }));
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });
  const phantomViolations = result.violations.filter((v) => v.rule === "leftover_phantom");
  assertEquals(phantomViolations.length, 1);
});

Deno.test("validateMealPlan does NOT flag status:\"leftover\" whose source_meal_id resolves to a real earlier meal", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) {
      return { day, meals: [meal({ id: "meal-1", title: "Monday Chicken Bowl" })] };
    }
    if (index === 1) {
      return {
        day,
        meals: [meal({
          id: "meal-2",
          title: "Tuesday Reheated Bowl",
          status: "leftover",
          source_meal_id: "meal-1",
        })],
      };
    }
    return { day, meals: [meal({ id: `meal-${index + 1}`, title: `Meal ${index + 1}` })] };
  });
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });
  const phantomViolations = result.violations.filter((v) => v.rule === "leftover_phantom");
  assertEquals(phantomViolations.length, 0);
});

Deno.test("validateMealPlan produces no leftover_phantom violations when status is absent (legacy/backward-compat)", () => {
  const days = daysWith(meal({ id: "meal-1" }));
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });
  const phantomViolations = result.violations.filter((v) => v.rule === "leftover_phantom");
  assertEquals(phantomViolations.length, 0);
});

// ---------------------------------------------------------------------------
// steps_too_few / steps_no_finish — §A2b "Step 1 and nothing else" evidence
// (VALID-01, D-04/D-05). RED phase (Task 1): validation.ts is untouched here
// — these Deno.test blocks assert violations that do not exist yet and are
// EXPECTED TO FAIL until Task 2 implements checkMealCompleteness().
// ---------------------------------------------------------------------------

/**
 * Sibling to meal() (line 6): same defaults, but with a realistic
 * multi-step, served-or-stored steps array so VALID-01 positive-path tests
 * aren't verbose. Does NOT mutate meal()'s intentionally-incomplete
 * single-step default — every existing test filters by `.rule`, so the
 * shared meal() fixture staying incomplete is harmless (Pitfall 3).
 */
function completeMeal(overrides: Record<string, unknown> = {}) {
  return {
    id: "meal-1",
    title: "Lemon Chicken Bowl",
    mealType: "dinner",
    servings: 1,
    calories: 420,
    protein: 32,
    carbs: 36,
    fats: 16,
    ingredients: [
      { name: "chicken thighs" },
      { name: "cumin" },
      { name: "smoked paprika" },
      { name: "dried oregano" },
    ],
    steps: [
      "Season the chicken with cumin, smoked paprika, and oregano.",
      "Sear the chicken 4 minutes per side until browned.",
      "Build a quick pan sauce with lemon and stock, then simmer 5 minutes.",
      "Serve over rice with a spoonful of pan sauce.",
    ],
    flavorNotes: "Lemony, smoky, and herby.",
    ...overrides,
  };
}

function daysWithFixture(fixture: ReturnType<typeof meal>, atIndex = 1) {
  return ORDERED_DAYS.map((day, index) => ({
    day,
    meals: [
      index === atIndex
        ? fixture
        : completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` }),
    ],
  }));
}

// §A2b evidence fixtures 1-4: each halts at exactly "Step 1" (RESEARCH.md
// Code Examples corpus).
const SEAR_CHICKEN_NO_SAUCE = meal({
  id: "meal-2",
  title: "Creamy Chicken Skillet",
  mealType: "dinner",
  steps: ["Sear chicken 3 min per side."],
});

const WILT_SPINACH_NO_EGG = meal({
  id: "meal-2",
  title: "Spinach Feta Omelette",
  mealType: "breakfast",
  steps: ["Wilt the spinach."],
});

const WHISK_YOGURT_EGGS_NO_PANCAKE = meal({
  id: "meal-2",
  title: "Yogurt Pancakes",
  mealType: "breakfast",
  steps: ["Whisk yogurt and eggs."],
});

const SHRIMP_NO_VEGETABLES = meal({
  id: "meal-2",
  title: "Garlic Shrimp Skillet",
  mealType: "dinner",
  steps: ["Cook the shrimp."],
});

Deno.test("validateMealPlan flags sear-chicken-no-sauce with steps_too_few and steps_no_finish (§A2b)", () => {
  const result = validateMealPlan(daysWithFixture(SEAR_CHICKEN_NO_SAUCE), [], {
    orderedDays: ORDERED_DAYS,
    householdSize: 1,
  });
  const tooFew = result.violations.filter((v) => v.rule === "steps_too_few");
  const noFinish = result.violations.filter((v) => v.rule === "steps_no_finish");
  assertEquals(tooFew.length, 1);
  assertEquals(tooFew[0]?.severity, "error");
  assertEquals(noFinish.length, 1);
  assertEquals(noFinish[0]?.severity, "error");
});

Deno.test("validateMealPlan flags wilt-spinach-no-egg with steps_too_few and steps_no_finish (§A2b)", () => {
  const result = validateMealPlan(daysWithFixture(WILT_SPINACH_NO_EGG), [], {
    orderedDays: ORDERED_DAYS,
    householdSize: 1,
  });
  const tooFew = result.violations.filter((v) => v.rule === "steps_too_few");
  const noFinish = result.violations.filter((v) => v.rule === "steps_no_finish");
  assertEquals(tooFew.length, 1);
  assertEquals(noFinish.length, 1);
});

Deno.test("validateMealPlan flags whisk-yogurt-eggs-no-pancake with steps_too_few and steps_no_finish (§A2b)", () => {
  const result = validateMealPlan(daysWithFixture(WHISK_YOGURT_EGGS_NO_PANCAKE), [], {
    orderedDays: ORDERED_DAYS,
    householdSize: 1,
  });
  const tooFew = result.violations.filter((v) => v.rule === "steps_too_few");
  const noFinish = result.violations.filter((v) => v.rule === "steps_no_finish");
  assertEquals(tooFew.length, 1);
  assertEquals(noFinish.length, 1);
});

Deno.test("validateMealPlan flags shrimp-no-vegetables with steps_too_few and steps_no_finish (§A2b)", () => {
  const result = validateMealPlan(daysWithFixture(SHRIMP_NO_VEGETABLES), [], {
    orderedDays: ORDERED_DAYS,
    householdSize: 1,
  });
  const tooFew = result.violations.filter((v) => v.rule === "steps_too_few");
  const noFinish = result.violations.filter((v) => v.rule === "steps_no_finish");
  assertEquals(tooFew.length, 1);
  assertEquals(noFinish.length, 1);
});

Deno.test("validateMealPlan does not flag completeMeal() with steps_too_few or steps_no_finish (backward-compat baseline)", () => {
  const days = ORDERED_DAYS.map((day, index) => ({
    day,
    meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })],
  }));
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });
  assertEquals(result.violations.filter((v) => v.rule === "steps_too_few").length, 0);
  assertEquals(result.violations.filter((v) => v.rule === "steps_no_finish").length, 0);
});

// 5th/6th §A2b fixtures: a hollow CREATES-LEFTOVER source poisons the chain
// unless caught at the source. The fix must flag the source meal itself,
// while a genuine downstream leftover with its own adequate steps stays
// clean — proving the fix protects the chain rather than merely detecting
// the standalone case.
const CREATES_LEFTOVER_SOURCE_HOLLOW = meal({
  id: "meal-src",
  title: "Big Batch Chicken Bake",
  mealType: "dinner",
  servings: 6,
  steps: ["Sear chicken 3 min per side."],
});

const DOWNSTREAM_LEFTOVER_COMPLETE = meal({
  id: "meal-leftover",
  title: "Chicken Bake Reheat",
  mealType: "dinner",
  servings: 2,
  status: "leftover",
  source_meal_id: "meal-src",
  steps: ["Reheat in the microwave 2 minutes.", "Serve hot."],
});

Deno.test("validateMealPlan flags a hollow CREATES-LEFTOVER source with steps_too_few and steps_no_finish, while its downstream leftover meal (adequate own steps) stays clean (§A2b chain)", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) return { day, meals: [CREATES_LEFTOVER_SOURCE_HOLLOW] };
    if (index === 1) return { day, meals: [DOWNSTREAM_LEFTOVER_COMPLETE] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });

  const sourceTooFew = result.violations.filter((v) => v.rule === "steps_too_few" && v.message.includes("Big Batch Chicken Bake"));
  const sourceNoFinish = result.violations.filter((v) => v.rule === "steps_no_finish" && v.message.includes("Big Batch Chicken Bake"));
  assertEquals(sourceTooFew.length, 1);
  assertEquals(sourceNoFinish.length, 1);

  const leftoverTooFew = result.violations.filter((v) => v.rule === "steps_too_few" && v.message.includes("Chicken Bake Reheat"));
  const leftoverNoFinish = result.violations.filter((v) => v.rule === "steps_no_finish" && v.message.includes("Chicken Bake Reheat"));
  assertEquals(leftoverTooFew.length, 0);
  assertEquals(leftoverNoFinish.length, 0);
});

// ---------------------------------------------------------------------------
// leftover_unresolvable_source (VALID-03, D-08). RED phase (Task 1):
// validation.ts is untouched here — these Deno.test blocks assert violations
// that do not exist yet and are EXPECTED TO FAIL until Task 2 implements the
// rule. All fixtures use completeMeal() so they don't incidentally trip
// VALID-01 rules and muddy the rule-filtered assertions.
// ---------------------------------------------------------------------------

const SALMON_SOURCE = completeMeal({
  id: "meal-salmon-src",
  title: "Zesty Grilled Salmon",
});

const UNRESOLVED_LEFTOVER_EARLIER_MATCH = completeMeal({
  id: "meal-leftover-unresolved",
  title: "Midweek Grain Bowl",
  mealType: "lunch",
  ingredients: [
    { name: "zesty grilled salmon" },
    { name: "mixed greens" },
    { name: "lemon vinaigrette" },
  ],
});

Deno.test("validateMealPlan flags a leftover-looking meal whose dish-name match is against an EARLIER meal's title, with no source_meal_id and no day-reference text (leftover_unresolvable_source, VALID-03)", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) return { day, meals: [SALMON_SOURCE] };
    if (index === 2) return { day, meals: [UNRESOLVED_LEFTOVER_EARLIER_MATCH] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });
  const unresolved = result.violations.filter((v) => v.rule === "leftover_unresolvable_source");
  assertEquals(unresolved.length, 1);
  assertEquals(unresolved[0]?.severity, "error");
});

const HARISSA_LATER_SOURCE = completeMeal({
  id: "meal-harissa-later",
  title: "Harissa Chicken Skewers",
});

const EARLY_MEAL_COINCIDENTAL_LATER_MATCH = completeMeal({
  id: "meal-early-coincidence",
  title: "Tuesday Grain Bowl",
  mealType: "lunch",
  ingredients: [
    { name: "harissa chicken skewers" },
    { name: "quinoa" },
    { name: "cucumber" },
  ],
});

Deno.test("validateMealPlan does NOT flag a leftover-looking meal whose dish-name match is only against a LATER meal's title (chronology guard, RESEARCH Pitfall 7)", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 1) return { day, meals: [EARLY_MEAL_COINCIDENTAL_LATER_MATCH] };
    if (index === 4) return { day, meals: [HARISSA_LATER_SOURCE] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });
  const unresolved = result.violations.filter((v) => v.rule === "leftover_unresolvable_source");
  assertEquals(unresolved.length, 0);
});

Deno.test("validateMealPlan does NOT flag leftover_unresolvable_source for a leftover fully resolved via a valid earlier source_meal_id", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) return { day, meals: [completeMeal({ id: "meal-1", title: "Monday Chicken Bowl" })] };
    if (index === 1) {
      return {
        day,
        meals: [completeMeal({
          id: "meal-2",
          title: "Tuesday Reheated Bowl",
          status: "leftover",
          source_meal_id: "meal-1",
          steps: ["Reheat in the microwave 2 minutes.", "Serve hot."],
        })],
      };
    }
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });
  assertEquals(result.violations.filter((v) => v.rule === "leftover_unresolvable_source").length, 0);
});

Deno.test("validateMealPlan does NOT flag leftover_unresolvable_source for a plain fresh meal with no leftover signal", () => {
  const days = ORDERED_DAYS.map((day, index) => ({
    day,
    meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })],
  }));
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 1 });
  assertEquals(result.violations.filter((v) => v.rule === "leftover_unresolvable_source").length, 0);
});

// ---------------------------------------------------------------------------
// serving_math_short (VALID-04, D-10). RED phase (Task 1): validation.ts is
// untouched here — these Deno.test blocks assert violations that do not
// exist yet and are EXPECTED TO FAIL until Task 2 implements the rule.
// ---------------------------------------------------------------------------

const OATS_SOURCE_SHORT = completeMeal({
  id: "meal-oats-src",
  title: "Overnight Oats Jars",
  mealType: "breakfast",
  servings: 2,
  steps: [
    "Cook oats with milk and cinnamon.",
    "Portion into jars and refrigerate for later.",
    "Chill overnight.",
  ],
});

const OATS_DEPENDENT_LEFTOVER = completeMeal({
  id: "meal-oats-leftover",
  title: "Grab-and-Go Oats Jar",
  mealType: "breakfast",
  servings: 3,
  status: "leftover",
  source_meal_id: "meal-oats-src",
  steps: ["Grab a jar from the fridge.", "Enjoy cold or warmed."],
});

Deno.test("validateMealPlan flags a source whose servings fall short of dependents + own-day consumption (serving_math_short, oats fixture)", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) return { day, meals: [OATS_SOURCE_SHORT] };
    if (index === 1) return { day, meals: [OATS_DEPENDENT_LEFTOVER] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 2 });
  const short = result.violations.filter((v) => v.rule === "serving_math_short");
  assertEquals(short.length, 1);
  assertEquals(short[0]?.severity, "error");
  assertEquals(short[0]?.message.includes('"Overnight Oats Jars"'), true);
  assertEquals(short[0]?.message.includes("serves 2"), true);
  assertEquals(short[0]?.message.includes("totaling 3 servings"), true);
});

const TURKEY_SOURCE_SHORT = completeMeal({
  id: "meal-turkey-src",
  title: "Big Batch Turkey Chili",
  mealType: "dinner",
  servings: 6,
});

const TURKEY_LUNCH_1 = completeMeal({
  id: "meal-turkey-lunch-1",
  title: "Turkey Chili Lunch Bowl",
  mealType: "lunch",
  servings: 2,
  status: "leftover",
  source_meal_id: "meal-turkey-src",
  steps: ["Reheat turkey chili in the microwave.", "Serve with a side of rice."],
});

const TURKEY_LUNCH_2 = completeMeal({
  id: "meal-turkey-lunch-2",
  title: "Turkey Chili Lunch Wrap",
  mealType: "lunch",
  servings: 2,
  status: "leftover",
  source_meal_id: "meal-turkey-src",
  steps: ["Reheat turkey chili in the microwave.", "Wrap in a warm tortilla and serve."],
});

Deno.test("validateMealPlan flags a source feeding 2 dependent lunches whose combined servings exceed source servings + own-day consumption (serving_math_short, turkey-batch fixture)", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) return { day, meals: [TURKEY_SOURCE_SHORT] };
    if (index === 1) return { day, meals: [TURKEY_LUNCH_1] };
    if (index === 2) return { day, meals: [TURKEY_LUNCH_2] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS });
  const short = result.violations.filter((v) => v.rule === "serving_math_short");
  assertEquals(short.length, 1);
  assertEquals(short[0]?.message.includes('"Big Batch Turkey Chili"'), true);
  assertEquals(short[0]?.message.includes("serves 6"), true);
  assertEquals(short[0]?.message.includes("totaling 4 servings"), true);
});

const SUFFICIENT_SOURCE = completeMeal({
  id: "meal-sufficient-src",
  title: "Hearty Lentil Stew",
  mealType: "dinner",
  servings: 10,
});

const SUFFICIENT_DEPENDENT = completeMeal({
  id: "meal-sufficient-dep",
  title: "Lentil Stew Leftover Lunch",
  mealType: "lunch",
  servings: 3,
  status: "leftover",
  source_meal_id: "meal-sufficient-src",
  steps: ["Reheat lentil stew in the microwave.", "Serve warm with crusty bread."],
});

Deno.test("validateMealPlan does NOT flag serving_math_short when source servings cover dependents + own-day consumption", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) return { day, meals: [SUFFICIENT_SOURCE] };
    if (index === 1) return { day, meals: [SUFFICIENT_DEPENDENT] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 2 });
  assertEquals(result.violations.filter((v) => v.rule === "serving_math_short").length, 0);
});

const OATS_SOURCE_EXEMPT_HOUSEHOLD = completeMeal({
  id: "meal-oats-exempt-src",
  title: "Batch Overnight Oats",
  mealType: "breakfast",
  servings: 2,
  steps: [
    "Cook oats with milk and cinnamon.",
    "Portion into jars and refrigerate for later.",
    "Chill overnight.",
  ],
});

const OATS_DEPENDENT_EXEMPT = completeMeal({
  id: "meal-oats-exempt-dep",
  title: "Grab-and-Go Oats Cup",
  mealType: "breakfast",
  servings: 3,
  status: "leftover",
  source_meal_id: "meal-oats-exempt-src",
  steps: ["Grab a jar from the fridge.", "Enjoy cold or warmed."],
});

Deno.test("validateMealPlan keeps serving_math_short and servings_household_mismatch distinct — the structured rule catches a source the household-size exemption lets pass (non-double-fire)", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) return { day, meals: [OATS_SOURCE_EXEMPT_HOUSEHOLD] };
    if (index === 1) return { day, meals: [OATS_DEPENDENT_EXEMPT] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  // householdSize (4) deliberately mismatches the source's 2 servings so the
  // existing isLeftoverSourceMeal exemption on servings_household_mismatch
  // actually has something to exempt.
  const result = validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, householdSize: 4 });

  const householdMismatchForSource = result.violations.filter(
    (v) => v.rule === "servings_household_mismatch" && v.message.includes("Batch Overnight Oats"),
  );
  assertEquals(householdMismatchForSource.length, 0);

  const short = result.violations.filter((v) => v.rule === "serving_math_short");
  assertEquals(short.length, 1);
});

// ---------------------------------------------------------------------------
// Batch integrity rules (BATCH-01/02, D-21): batch_id_duplicate,
// batch_ref_unresolved, leftover_batch_missing, batch_orphaned. batches
// arrives via the OPTIONAL options.batches field (default []) — withBatches
// wraps daysWith(...)/completeMeal-built days and threads the batches array
// through to validateMealPlan, reused across every fixture below.
// ---------------------------------------------------------------------------

/** Sibling to completeMeal(): a minimal, all-required-but-nullable PrepBatch
 * fixture (D-02 field list). */
function batch(overrides: Record<string, unknown> = {}) {
  return {
    id: "Q1",
    task: "Cook 3 cups quinoa. Cool and portion.",
    yield: "3 cups cooked quinoa",
    storage: "Refrigerate up to 4 days",
    useBy: "Friday",
    time: "~15 min",
    ...overrides,
  };
}

/** Wraps a days array + a batches array into a validateMealPlan call,
 * threading batches through the OPTIONAL options.batches field so every new
 * batch-rule test avoids repeating the same call boilerplate. */
function withBatches(
  days: ReturnType<typeof daysWith>,
  batches: Array<ReturnType<typeof batch>>,
  options: Record<string, unknown> = {},
) {
  return validateMealPlan(days, [], { orderedDays: ORDERED_DAYS, ...options, batches });
}

Deno.test("validateMealPlan flags two batches sharing an id (batch_id_duplicate)", () => {
  const days = daysWith(meal({ id: "meal-1" }));
  const result = withBatches(days, [
    batch({ id: "S1" }),
    batch({ id: "S1", task: "A different task under the same id." }),
  ]);
  const dup = result.violations.filter((v) => v.rule === "batch_id_duplicate");
  assertEquals(dup.length, 1);
  assertEquals(dup[0]?.severity, "error");
});

Deno.test("validateMealPlan flags a meal uses[] ref with no matching batch (batch_ref_unresolved)", () => {
  const days = daysWith(meal({ id: "meal-1", uses: ["Z9"] }));
  const result = withBatches(days, [batch({ id: "Q1" })]);
  const unresolved = result.violations.filter((v) => v.rule === "batch_ref_unresolved");
  assertEquals(unresolved.length, 1);
  assertEquals(unresolved[0]?.severity, "error");
  assertEquals(unresolved[0]?.message.includes("Z9"), true);
  assertEquals(unresolved[0]?.message.includes("Q1"), true);
});

Deno.test("validateMealPlan flags a meal creates id with no matching batch (batch_ref_unresolved)", () => {
  const days = daysWith(meal({ id: "meal-1", creates: "X1" }));
  const result = withBatches(days, []);
  const unresolved = result.violations.filter((v) => v.rule === "batch_ref_unresolved");
  assertEquals(unresolved.length, 1);
  assertEquals(unresolved[0]?.severity, "error");
  assertEquals(unresolved[0]?.message.includes("X1"), true);
});

Deno.test("validateMealPlan produces zero batch_id_duplicate/batch_ref_unresolved when every batch id is unique and every ref resolves", () => {
  const days = daysWith(meal({ id: "meal-1", uses: ["Q1"], creates: "S1" }));
  const result = withBatches(days, [batch({ id: "Q1" }), batch({ id: "S1" })]);
  assertEquals(result.violations.filter((v) => v.rule === "batch_id_duplicate").length, 0);
  assertEquals(result.violations.filter((v) => v.rule === "batch_ref_unresolved").length, 0);
});

const BATCH_LEFTOVER_SOURCE = completeMeal({
  id: "meal-batch-leftover-src",
  title: "Sheet-Pan Salmon Dinner",
  mealType: "dinner",
  servings: 6,
  creates: "S1",
});

const BATCH_LEFTOVER_EMPTY_USES = completeMeal({
  id: "meal-batch-leftover-empty",
  title: "Salmon Leftover Lunch",
  mealType: "lunch",
  servings: 2,
  status: "leftover",
  source_meal_id: "meal-batch-leftover-src",
  uses: [],
});

Deno.test("validateMealPlan flags a status:\"leftover\" meal with empty uses[] (leftover_batch_missing)", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) return { day, meals: [BATCH_LEFTOVER_SOURCE] };
    if (index === 1) return { day, meals: [BATCH_LEFTOVER_EMPTY_USES] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = withBatches(days, [batch({ id: "S1" })], { householdSize: 4 });
  const missing = result.violations.filter((v) => v.rule === "leftover_batch_missing");
  assertEquals(missing.length, 1);
  assertEquals(missing[0]?.severity, "error");
});

Deno.test("validateMealPlan does NOT flag leftover_batch_missing when a leftover's uses[] resolves against a declared batch", () => {
  const resolvedLeftover = completeMeal({
    ...BATCH_LEFTOVER_EMPTY_USES,
    uses: ["S1"],
  });
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) return { day, meals: [BATCH_LEFTOVER_SOURCE] };
    if (index === 1) return { day, meals: [resolvedLeftover] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = withBatches(days, [batch({ id: "S1" })], { householdSize: 4 });
  assertEquals(result.violations.filter((v) => v.rule === "leftover_batch_missing").length, 0);
});

Deno.test("validateMealPlan flags a declared batch that no meal's uses[] references (batch_orphaned) without flipping the plan invalid", () => {
  const days = ORDERED_DAYS.map((day, index) => ({
    day,
    meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })],
  }));
  const result = withBatches(days, [batch({ id: "Q1" })], { householdSize: 1 });
  const orphaned = result.violations.filter((v) => v.rule === "batch_orphaned");
  assertEquals(orphaned.length, 1);
  assertEquals(orphaned[0]?.severity, "warning");
  assertEquals(result.valid, true);
});

// Friday Quinoa Taco Bowl (17-CONTEXT.md Specifics — the serving-math/batch
// repeated-uses fixture): two lunches on different days both reference the
// SAME two batch ids. This must resolve cleanly for both — batch_ref_unresolved
// must NOT false-positive just because two meals share a uses[] pair.
const QUINOA_BATCH = batch({ id: "Q1", task: "Cook 3 cups quinoa. Cool and portion.", yield: "3 cups cooked quinoa" });
const TACO_TURKEY_BATCH = batch({ id: "T1", task: "Brown and season 1 lb ground turkey.", yield: "3 cups seasoned turkey" });

const TUESDAY_QUINOA_TACO_BOWL = completeMeal({
  id: "meal-tue-quinoa-taco",
  title: "Quinoa Taco Bowl",
  mealType: "lunch",
  uses: ["Q1", "T1"],
});

const FRIDAY_QUINOA_TACO_BOWL = completeMeal({
  id: "meal-fri-quinoa-taco",
  title: "Quinoa Taco Bowl",
  mealType: "lunch",
  uses: ["Q1", "T1"],
});

Deno.test("validateMealPlan does NOT flag batch_ref_unresolved for the Friday Quinoa Taco Bowl fixture (two lunches both uses:[\"Q1\",\"T1\"])", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (day === "Tuesday") return { day, meals: [TUESDAY_QUINOA_TACO_BOWL] };
    if (day === "Friday") return { day, meals: [FRIDAY_QUINOA_TACO_BOWL] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = withBatches(days, [QUINOA_BATCH, TACO_TURKEY_BATCH], { householdSize: 1 });
  assertEquals(result.violations.filter((v) => v.rule === "batch_ref_unresolved").length, 0);
});

// serving_math_short (D-22): confirm the EXISTING, UNCHANGED rule still
// fires for a batch-model leftover — it carries source_meal_id regardless
// of the new uses/creates refs, so no rule change was needed.
const BATCH_SOURCE_SHORT = completeMeal({
  id: "meal-batch-src-short",
  title: "Big Batch Salmon Dinner",
  mealType: "dinner",
  servings: 2,
  creates: "S1",
});

const BATCH_DEPENDENT_LEFTOVER_SHORT = completeMeal({
  id: "meal-batch-dep-short",
  title: "Salmon Leftover Lunch",
  mealType: "lunch",
  servings: 3,
  status: "leftover",
  source_meal_id: "meal-batch-src-short",
  uses: ["S1"],
  ingredients: [
    { name: "3 prepared salmon portions from Batch S1" },
    { name: "mixed greens" },
    { name: "lemon vinaigrette" },
  ],
  steps: ["Reheat salmon portions in the microwave 2 minutes.", "Serve over greens with vinaigrette."],
});

Deno.test("validateMealPlan confirms serving_math_short still fires for a batch-model leftover carrying uses/creates refs (D-22, no rule change)", () => {
  const days = ORDERED_DAYS.map((day, index) => {
    if (index === 0) return { day, meals: [BATCH_SOURCE_SHORT] };
    if (index === 1) return { day, meals: [BATCH_DEPENDENT_LEFTOVER_SHORT] };
    return { day, meals: [completeMeal({ id: `meal-${index + 1}`, title: `Filler Meal ${index + 1}` })] };
  });
  const result = withBatches(days, [batch({ id: "S1" })], { householdSize: 2 });
  const short = result.violations.filter((v) => v.rule === "serving_math_short");
  assertEquals(short.length, 1);
  assertEquals(short[0]?.severity, "error");
  assertEquals(short[0]?.message.includes('"Big Batch Salmon Dinner"'), true);
  // No batch_ref_unresolved/leftover_batch_missing noise — uses:["S1"] resolves.
  assertEquals(result.violations.filter((v) => v.rule === "batch_ref_unresolved").length, 0);
  assertEquals(result.violations.filter((v) => v.rule === "leftover_batch_missing").length, 0);
});

// ---------------------------------------------------------------------------
// Nutrition plausibility (Phase 18, Task 1 — NUTR-01) — Atwater internal
// consistency (nutrition_implausible) + per-serving bounds sanity
// (nutrition_bounds). Both severity "error", riding the existing fix-retry
// via the shared checkMealNutrition helper (D-08, "one function, two
// callers" — validateMealPlan errors-ride-retry / validateSwapMeal
// detect-and-log). Deviation base for Atwater is REPORTED calories — see the
// daysWith() secondary-fixture assertion below (D-03 fixture-survival trap).
// ---------------------------------------------------------------------------

Deno.test("validateMealPlan flags an Atwater-inconsistent meal (nutrition_implausible)", () => {
  const implausible = completeMeal({
    id: "meal-1",
    title: "Implausible Bowl",
    calories: 300,
    protein: 10,
    carbs: 10,
    fats: 5,
  });
  const result = validateMealPlan(daysWith(implausible), [], { orderedDays: ORDERED_DAYS });
  const violations = result.violations.filter((v) => v.rule === "nutrition_implausible");
  assertEquals(violations.length, 1);
  assertEquals(violations[0].severity, "error");
  assertEquals(violations[0].message.includes('"Implausible Bowl"'), true);
  assertEquals(violations[0].message.includes("300"), true);
  assertEquals(violations[0].message.includes("10g protein"), true);
  assertEquals(violations[0].message.includes("10g carbs"), true);
  assertEquals(violations[0].message.includes("5g fats"), true);
  assertEquals(violations[0].message.includes("125"), true); // Atwater = 4*10 + 4*10 + 9*5 = 125
});

Deno.test("validateMealPlan produces zero nutrition_implausible violations on the meal()/daysWith() fixtures (dev 4 and dev 100, fixture survival)", () => {
  const result = validateMealPlan(daysWith(meal()), [], { orderedDays: ORDERED_DAYS });
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_implausible").length, 0);
});

Deno.test("validateMealPlan flags a 4-serving dinner with whole-recipe calories pasted into the per-serving field (nutrition_bounds, calories)", () => {
  const overStuffed = completeMeal({
    id: "meal-1",
    title: "Family Style Casserole",
    servings: 4,
    calories: 1600,
    protein: 90,
    carbs: 180,
    fats: 70,
  });
  const result = validateMealPlan(daysWith(overStuffed), [], { orderedDays: ORDERED_DAYS });
  const violations = result.violations.filter((v) => v.rule === "nutrition_bounds");
  assertEquals(violations.length, 1);
  assertEquals(violations[0].severity, "error");
  assertEquals(violations[0].message.includes('"Family Style Casserole"'), true);
  assertEquals(violations[0].message.includes("1600"), true);
  assertEquals(violations[0].message.includes("1400"), true);
  // Atwater (1710) is within the 400kcal tolerance of 1600 — not also flagged implausible.
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_implausible").length, 0);
});

Deno.test("validateMealPlan produces zero nutrition_bounds violations for a snack within its generous range", () => {
  const snack = completeMeal({
    id: "meal-1",
    title: "Afternoon Snack",
    mealType: "snack",
    servings: 1,
    calories: 650,
    protein: 30,
    carbs: 70,
    fats: 20,
    steps: ["Portion into a bowl and serve immediately."],
  });
  const result = validateMealPlan(daysWith(snack), [], { orderedDays: ORDERED_DAYS });
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_bounds").length, 0);
});

Deno.test("validateMealPlan flags a per-serving protein value above the plausible max (nutrition_bounds, protein)", () => {
  const overProtein = completeMeal({
    id: "meal-1",
    title: "Protein Overload Bowl",
    calories: 700,
    protein: 120,
    carbs: 20,
    fats: 20,
  });
  const result = validateMealPlan(daysWith(overProtein), [], { orderedDays: ORDERED_DAYS });
  const violations = result.violations.filter((v) => v.rule === "nutrition_bounds");
  assertEquals(violations.length, 1);
  assertEquals(violations[0].message.includes("120"), true);
  assertEquals(violations[0].message.includes("100"), true);
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_implausible").length, 0);
});

Deno.test("validateMealPlan does NOT flag nutrition_bounds or nutrition_implausible when a macro is zero (nutrition_zero owns that meal, D-04 non-double-fire)", () => {
  const zeroProtein = completeMeal({
    id: "meal-1",
    title: "Zero Protein Bowl",
    protein: 0,
  });
  const result = validateMealPlan(daysWith(zeroProtein), [], { orderedDays: ORDERED_DAYS });
  assertEquals(
    result.violations.filter((v) => v.rule === "nutrition_zero" && v.message.includes('"Zero Protein Bowl"')).length,
    1,
  );
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_bounds").length, 0);
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_implausible").length, 0);
});

Deno.test("validateMealPlan does not throw and produces no nutrition violations on non-finite macros (Gemini fallback path, T-18-01)", () => {
  const nonFinite = completeMeal({
    id: "meal-1",
    title: "Malformed Macro Bowl",
    calories: NaN,
    protein: Infinity,
  });
  const result = validateMealPlan(daysWith(nonFinite), [], { orderedDays: ORDERED_DAYS });
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_implausible").length, 0);
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_bounds").length, 0);
});

Deno.test("validateSwapMeal runs checkMealNutrition as detect-and-log (nutrition_implausible fires on the swap surface, D-08)", () => {
  const violations = validateSwapMeal({
    title: "Implausible Swap Bowl",
    mealType: "dinner",
    servings: 1,
    calories: 300,
    protein: 10,
    carbs: 10,
    fats: 5,
    ingredients: [{ name: "chicken thighs" }],
    steps: ["Season and cook the chicken.", "Serve warm."],
    flavorNotes: "Simple and warm.",
  }, [], {});
  const implausible = violations.filter((v) => v.rule === "nutrition_implausible");
  assertEquals(implausible.length, 1);
  assertEquals(implausible[0].severity, "error");
});

// ---------------------------------------------------------------------------
// Nutrition tag contradiction + protein heuristic (Phase 18, Task 2 —
// NUTR-01/02). contradictoryNutritionTags is a pure, exported helper
// (Plan 18-02's edge tag strip contract); nutrition_tag_contradiction and
// nutrition_protein_unsupported are both severity "warning" — they never
// ride the fix-retry (formatViolationsForRetry filters severity:"error"
// only).
// ---------------------------------------------------------------------------

Deno.test("contradictoryNutritionTags flags a Low Carb tag when carbs exceed the shared threshold (36g > 35g)", () => {
  const result = contradictoryNutritionTags(completeMeal({ tags: ["Low Carb"], carbs: 36 }));
  assertEquals(result, ["Low Carb"]);
});

Deno.test("contradictoryNutritionTags flags a Keto tag when carbs exceed the shared threshold (21g > 20g)", () => {
  const result = contradictoryNutritionTags(completeMeal({ tags: ["Keto"], carbs: 21 }));
  assertEquals(result, ["Keto"]);
});

Deno.test("contradictoryNutritionTags flags a High Protein tag when protein falls below the floor (8g < 10g)", () => {
  const result = contradictoryNutritionTags(completeMeal({ tags: ["High Protein"], protein: 8 }));
  assertEquals(result, ["High Protein"]);
});

Deno.test("contradictoryNutritionTags does not flag a Low Carb tag whose carbs are within the threshold (30g, consistent)", () => {
  const result = contradictoryNutritionTags(completeMeal({ tags: ["Low Carb"], carbs: 30 }));
  assertEquals(result, []);
});

Deno.test("contradictoryNutritionTags does not flag a Low Carb tag at exactly the threshold (35g, not over — aligns with dietary_preference_mismatch's > 35)", () => {
  const result = contradictoryNutritionTags(completeMeal({ tags: ["Low Carb"], carbs: 35 }));
  assertEquals(result, []);
});

Deno.test("contradictoryNutritionTags never flags uncheckable or non-nutrition tags (High Fiber, Mediterranean, Toddler-Friendly)", () => {
  const result = contradictoryNutritionTags(completeMeal({
    tags: ["High Fiber", "Mediterranean", "Toddler-Friendly"],
    carbs: 100, // would trip Low Carb/Keto if either tag were present — it isn't
    protein: 5, // would trip High Protein if that tag were present — it isn't
  }));
  assertEquals(result, []);
});

Deno.test("contradictoryNutritionTags normalizes tag matching (case/hyphen/spacing-insensitive)", () => {
  for (const variant of ["LOW CARB", "low-carb", "Low  Carb"]) {
    const result = contradictoryNutritionTags(completeMeal({ tags: [variant], carbs: 40 }));
    assertEquals(result, [variant]);
  }
});

Deno.test("contradictoryNutritionTags returns [] for a meal with no tags array", () => {
  const result = contradictoryNutritionTags(completeMeal({ carbs: 100, protein: 2 }));
  assertEquals(result, []);
});

Deno.test("validateMealPlan flags nutrition_tag_contradiction for a Low Carb tag over the shared threshold (36g)", () => {
  const lowCarbOver = completeMeal({ id: "meal-1", title: "Low Carb Claim Bowl", tags: ["Low Carb"], carbs: 36 });
  const result = validateMealPlan(daysWith(lowCarbOver), [], { orderedDays: ORDERED_DAYS });
  const violations = result.violations.filter((v) => v.rule === "nutrition_tag_contradiction");
  assertEquals(violations.length, 1);
  assertEquals(violations[0].severity, "warning");
  assertEquals(violations[0].message.includes('"Low Carb Claim Bowl"'), true);
  assertEquals(violations[0].message.includes("Low Carb"), true);
  assertEquals(violations[0].message.includes("36"), true);
  assertEquals(violations[0].message.includes("35"), true);
});

Deno.test("validateMealPlan does NOT flag nutrition_tag_contradiction for a Low Carb tag at exactly the threshold (35g)", () => {
  const lowCarbAt = completeMeal({ id: "meal-1", title: "Low Carb At Threshold Bowl", tags: ["Low Carb"], carbs: 35 });
  const result = validateMealPlan(daysWith(lowCarbAt), [], { orderedDays: ORDERED_DAYS });
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_tag_contradiction").length, 0);
});

Deno.test("validateMealPlan flags nutrition_tag_contradiction for a Keto tag over threshold (21g) and a High Protein tag under floor (8g)", () => {
  const ketoOver = completeMeal({ id: "meal-1", title: "Keto Claim Bowl", tags: ["Keto"], carbs: 21 });
  const ketoResult = validateMealPlan(daysWith(ketoOver), [], { orderedDays: ORDERED_DAYS });
  assertEquals(ketoResult.violations.filter((v) => v.rule === "nutrition_tag_contradiction").length, 1);

  const highProteinUnder = completeMeal({ id: "meal-1", title: "High Protein Claim Bowl", tags: ["High Protein"], protein: 8 });
  const proteinResult = validateMealPlan(daysWith(highProteinUnder), [], { orderedDays: ORDERED_DAYS });
  assertEquals(proteinResult.violations.filter((v) => v.rule === "nutrition_tag_contradiction").length, 1);
});

Deno.test("validateMealPlan does NOT flag nutrition_tag_contradiction for High Fiber, Mediterranean, or Toddler-Friendly tags", () => {
  const uncheckable = completeMeal({
    id: "meal-1",
    title: "Uncheckable Tags Bowl",
    tags: ["High Fiber", "Mediterranean", "Toddler-Friendly"],
  });
  const result = validateMealPlan(daysWith(uncheckable), [], { orderedDays: ORDERED_DAYS });
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_tag_contradiction").length, 0);
});

Deno.test("validateMealPlan flags nutrition_protein_unsupported for an outlier protein claim with no detectable protein-source ingredient (fruit-salad snack, D-05)", () => {
  const fruitSalad = completeMeal({
    id: "meal-1",
    title: "Fruit Salad Snack",
    mealType: "snack",
    calories: 332,
    protein: 45,
    carbs: 20,
    fats: 8,
    ingredients: [{ name: "strawberries" }, { name: "blueberries" }, { name: "mint" }],
    steps: ["Toss the fruit together.", "Serve chilled."],
  });
  const result = validateMealPlan(daysWith(fruitSalad), [], { orderedDays: ORDERED_DAYS });
  const violations = result.violations.filter((v) => v.rule === "nutrition_protein_unsupported");
  assertEquals(violations.length, 1);
  assertEquals(violations[0].severity, "warning");
  assertEquals(violations[0].message.includes('"Fruit Salad Snack"'), true);
  assertEquals(violations[0].message.includes("45"), true);
});

Deno.test("validateMealPlan does NOT flag nutrition_protein_unsupported for a Greek-yogurt breakfast (documents the accepted dairy blind spot, D-05)", () => {
  const greekYogurt = completeMeal({
    id: "meal-1",
    title: "Greek Yogurt Bowl",
    mealType: "breakfast",
    protein: 25,
    ingredients: [{ name: "greek yogurt" }, { name: "honey" }, { name: "granola" }],
    steps: ["Layer yogurt with honey and granola.", "Serve immediately."],
  });
  const result = validateMealPlan(daysWith(greekYogurt), [], { orderedDays: ORDERED_DAYS });
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_protein_unsupported").length, 0);
});

Deno.test("validateMealPlan does NOT flag nutrition_protein_unsupported for a chicken dinner where detectProtein resolves", () => {
  const chickenDinner = completeMeal({
    id: "meal-1",
    title: "Roast Chicken Dinner",
    calories: 500,
    protein: 45,
    carbs: 25,
    fats: 20,
  }); // completeMeal() default ingredients already include "chicken thighs"
  const result = validateMealPlan(daysWith(chickenDinner), [], { orderedDays: ORDERED_DAYS });
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_protein_unsupported").length, 0);
});

Deno.test("nutrition_tag_contradiction and nutrition_protein_unsupported are severity warning and never appear in formatViolationsForRetry output", () => {
  const violatingMeal = completeMeal({
    id: "meal-1",
    title: "Contradiction Bowl",
    tags: ["Low Carb"],
    calories: 430,
    protein: 45,
    carbs: 40,
    fats: 10,
    ingredients: [{ name: "strawberries" }, { name: "blueberries" }],
  });
  const result = validateMealPlan(daysWith(violatingMeal), [], { orderedDays: ORDERED_DAYS });
  const tagViolations = result.violations.filter((v) => v.rule === "nutrition_tag_contradiction");
  const proteinViolations = result.violations.filter((v) => v.rule === "nutrition_protein_unsupported");
  assertEquals(tagViolations.length, 1);
  assertEquals(tagViolations[0].severity, "warning");
  assertEquals(proteinViolations.length, 1);
  assertEquals(proteinViolations[0].severity, "warning");

  const retryText = formatViolationsForRetry(result.violations);
  assertEquals(retryText.includes(tagViolations[0].message), false);
  assertEquals(retryText.includes(proteinViolations[0].message), false);
});

// ---------------------------------------------------------------------------
// Fixture-survival + non-double-fire regression guard (Phase 18, Task 3).
// Pins the phase's load-bearing calibration guarantees separately from Task
// 1/2's behavior tests, so a future tweak to ATWATER_TOL_PCT/
// ATWATER_TOL_FLOOR_KCAL or the bounds constants fails loudly here rather
// than silently drifting. Does NOT modify meal()/daysWith().
// ---------------------------------------------------------------------------

Deno.test("validateMealPlan produces zero nutrition_implausible, nutrition_bounds, and nutrition_protein_unsupported violations on the standard meal()/daysWith() fixtures (fixture survival, D-03)", () => {
  const result = validateMealPlan(daysWith(meal()), [], { orderedDays: ORDERED_DAYS });
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_implausible").length, 0);
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_bounds").length, 0);
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_protein_unsupported").length, 0);
});

Deno.test("validateMealPlan does not double-fire nutrition_bounds/nutrition_implausible alongside nutrition_zero for a zero-protein meal (D-04)", () => {
  const zeroProtein = meal({ id: "meal-1", title: "Zero Protein Regression Bowl", protein: 0 });
  const result = validateMealPlan(daysWith(zeroProtein), [], { orderedDays: ORDERED_DAYS });
  assertEquals(
    result.violations.filter((v) =>
      v.rule === "nutrition_zero" && v.message.includes('"Zero Protein Regression Bowl"')
    ).length,
    1,
  );
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_bounds").length, 0);
  assertEquals(result.violations.filter((v) => v.rule === "nutrition_implausible").length, 0);
});

Deno.test("validateMealPlan excludes a pinned meal with absurd macros from every nutrition rule (pinned stubs never reach allMeals)", () => {
  const pinnedStub = meal({
    id: "meal-1",
    title: "Pinned Absurd Bowl",
    pinned: true,
    calories: 9999,
    protein: 9999,
    carbs: 9999,
    fats: 9999,
  });
  const result = validateMealPlan(daysWith(pinnedStub), [], { orderedDays: ORDERED_DAYS });
  assertEquals(result.violations.filter((v) => v.message.includes("Pinned Absurd Bowl")).length, 0);
});
