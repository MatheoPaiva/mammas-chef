import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeDinnerCuisineTitle } from "./dinnerCuisineTitle.ts";

// Helper to build a minimal PlannerDay structure for tests.
function makeDay(
  dinners: string[][],
  extras: { mealType: string; tags: string[] }[] = [],
) {
  return {
    meals: [
      ...dinners.map((tags) => ({ mealType: "dinner", tags })),
      ...extras,
    ],
  };
}

// Test A (repro): 4 Mediterranean, 2 Mexican, 1 Italian dinners → lead ≥ 2 → "Mediterranean"
Deno.test("Test A: Mediterranean leads by >=2 dinners → returns Mediterranean", () => {
  const days = [
    makeDay([["mediterranean"], ["mediterranean"], ["mediterranean"], ["mediterranean"]]),
    makeDay([["mexican"], ["mexican"]]),
    makeDay([["italian"]]),
  ];
  assertEquals(computeDinnerCuisineTitle(days), "Mediterranean");
});

// Test B (lead 1): 3 Mediterranean, 2 Mexican, 2 Italian → lead of 1 → null
Deno.test("Test B: Mediterranean leads by only 1 → returns null", () => {
  const days = [
    makeDay([["mediterranean"], ["mediterranean"], ["mediterranean"]]),
    makeDay([["mexican"], ["mexican"]]),
    makeDay([["italian"], ["italian"]]),
  ];
  assertEquals(computeDinnerCuisineTitle(days), null);
});

// Test C (tie): 3 Mediterranean, 3 Mexican, 1 Italian → tie → null
Deno.test("Test C: Tie between Mediterranean and Mexican → returns null", () => {
  const days = [
    makeDay([["mediterranean"], ["mediterranean"], ["mediterranean"]]),
    makeDay([["mexican"], ["mexican"], ["mexican"]]),
    makeDay([["italian"]]),
  ];
  assertEquals(computeDinnerCuisineTitle(days), null);
});

// Test D (zero dinners): only breakfast/lunch/snack meals → null
Deno.test("Test D: Zero dinner meals → returns null", () => {
  const days = [
    {
      meals: [
        { mealType: "breakfast", tags: ["mediterranean"] },
        { mealType: "lunch", tags: ["mediterranean"] },
        { mealType: "snack", tags: ["mediterranean"] },
      ],
    },
  ];
  assertEquals(computeDinnerCuisineTitle(days), null);
});

// Test E (no recognizable cuisine tags on dinners): dinners with unrecognized tags → null
Deno.test("Test E: Dinner meals with no known cuisine tags → returns null", () => {
  const days = [
    makeDay([
      ["quick", "easy", "family"],
      ["healthy", "toddler-friendly"],
      ["gluten-free", "dairy-free"],
      ["high-protein", "batch-cook"],
    ]),
  ];
  assertEquals(computeDinnerCuisineTitle(days), null);
});

// Test F (CR-01 regression): AI-fallback path can pass malformed meals where
// `tags` is missing/non-array and `meals` may be absent. Must degrade to null,
// never throw a TypeError that would discard a fully-generated plan.
Deno.test("Test F: Malformed meals (missing/non-array tags, missing meals) → returns null, no throw", () => {
  const malformed = [
    { meals: [{ mealType: "dinner" }] }, // tags undefined
    { meals: [{ mealType: "dinner", tags: null }] }, // tags non-array
    { meals: [{ mealType: "dinner", tags: "mediterranean" }] }, // tags a string, not array
    {}, // meals absent
  ] as unknown as Parameters<typeof computeDinnerCuisineTitle>[0];
  assertEquals(computeDinnerCuisineTitle(malformed), null);
});
