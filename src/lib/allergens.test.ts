/**
 * Tests for the allergen keyword checker in
 * supabase/functions/_shared/allergens.ts. It is pure logic with no Deno
 * dependencies, so the real module is imported here (the app imports it too).
 */
import { describe, it, expect } from "vitest";
import { checkAllergens as checkRecipeAllergens } from "../../supabase/functions/_shared/allergens";

/** These tests list ingredients as plain strings; the checker takes `{ name }` objects. */
const checkAllergens = (recipes: Array<{ title: string; ingredients: string[] }>, userAllergens: string[]) =>
  checkRecipeAllergens(
    recipes.map((r) => ({ title: r.title, ingredients: r.ingredients.map((name) => ({ name })) })),
    userAllergens,
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkAllergens", () => {
  // --- Basic detection ---

  it("returns empty array when no allergens specified", () => {
    const recipes = [{ title: "Test", ingredients: ["1 cup almond milk"] }];
    expect(checkAllergens(recipes, [])).toEqual([]);
  });

  it("returns empty array for clean recipes", () => {
    const recipes = [{ title: "Grilled Chicken", ingredients: ["1 lb chicken breast", "1 cup rice", "1 tsp cumin"] }];
    expect(checkAllergens(recipes, ["Nuts", "Shellfish"])).toEqual([]);
  });

  it("detects almond butter for nut allergy", () => {
    const recipes = [{ title: "Toast", ingredients: ["2 tbsp almond butter", "1 slice bread"] }];
    const result = checkAllergens(recipes, ["Nuts"]);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].allergen).toBe("Nuts");
    expect(result[0].matchedKeyword).toBe("almond"); // "almond" matches first in keyword list
  });

  it("detects shrimp for shellfish allergy", () => {
    const recipes = [{ title: "Stir Fry", ingredients: ["8 oz shrimp", "2 cups rice"] }];
    const result = checkAllergens(recipes, ["Shellfish"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("shrimp");
  });

  it("detects eggs for egg allergy", () => {
    const recipes = [{ title: "Scramble", ingredients: ["4 eggs", "1 cup spinach"] }];
    const result = checkAllergens(recipes, ["Eggs"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("egg"); // "egg" matches before "eggs" in keyword list
  });

  it("detects tahini for sesame allergy", () => {
    const recipes = [{ title: "Hummus Bowl", ingredients: ["1 can chickpeas", "2 tbsp tahini"] }];
    const result = checkAllergens(recipes, ["Sesame"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("tahini");
  });

  it("detects feta for milk allergy", () => {
    const recipes = [{ title: "Greek Salad", ingredients: ["1 cup feta", "2 cups greens"] }];
    const result = checkAllergens(recipes, ["Milk"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("feta");
  });

  it("detects tofu for soy allergy", () => {
    const recipes = [{ title: "Tofu Bowl", ingredients: ["14 oz extra-firm tofu", "1 cup rice"] }];
    const result = checkAllergens(recipes, ["Soy"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("tofu");
  });

  it("detects salmon for fish allergy", () => {
    const recipes = [{ title: "Salmon Bowl", ingredients: ["6 oz salmon fillet", "1 cup quinoa"] }];
    const result = checkAllergens(recipes, ["Fish"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("salmon");
  });

  it("detects peanut butter for peanut allergy", () => {
    const recipes = [{ title: "PB Smoothie", ingredients: ["2 tbsp peanut butter", "1 banana"] }];
    const result = checkAllergens(recipes, ["Peanuts"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("peanut"); // "peanut" matches first in keyword list
  });

  it("detects pasta for wheat allergy", () => {
    const recipes = [{ title: "Pasta Bake", ingredients: ["8 oz pasta", "1 cup marinara"] }];
    const result = checkAllergens(recipes, ["Wheat"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("pasta");
  });

  // --- False positive handling ---

  it("does NOT flag butternut squash for nut allergy", () => {
    const recipes = [{ title: "Soup", ingredients: ["1 butternut squash", "2 cups broth"] }];
    expect(checkAllergens(recipes, ["Nuts"])).toEqual([]);
  });

  it("does NOT flag nutmeg for nut allergy", () => {
    const recipes = [{ title: "Oatmeal", ingredients: ["1/4 tsp nutmeg", "1 cup oats"] }];
    expect(checkAllergens(recipes, ["Nuts"])).toEqual([]);
  });

  it("does NOT flag coconut for nut allergy", () => {
    const recipes = [{ title: "Curry", ingredients: ["1 cup coconut milk", "1 lb chicken"] }];
    expect(checkAllergens(recipes, ["Nuts"])).toEqual([]);
  });

  it("does NOT flag eggplant for egg allergy", () => {
    const recipes = [{ title: "Baba Ganoush", ingredients: ["1 large eggplant", "2 tbsp tahini"] }];
    expect(checkAllergens(recipes, ["Eggs"])).toEqual([]);
  });

  it("does NOT flag coconut milk for milk allergy", () => {
    const recipes = [{ title: "Thai Curry", ingredients: ["1 can coconut milk", "1 lb shrimp"] }];
    expect(checkAllergens(recipes, ["Milk"])).toEqual([]);
  });

  it("does NOT flag coconut cream for milk allergy", () => {
    const recipes = [{ title: "Dessert", ingredients: ["1 cup coconut cream", "1 cup berries"] }];
    expect(checkAllergens(recipes, ["Milk"])).toEqual([]);
  });

  it("does NOT flag peanut butter for milk allergy (butter false positive)", () => {
    const recipes = [{ title: "Snack", ingredients: ["2 tbsp peanut butter", "1 apple"] }];
    expect(checkAllergens(recipes, ["Milk"])).toEqual([]);
  });

  it("does NOT flag rice flour for wheat allergy", () => {
    const recipes = [{ title: "GF Bread", ingredients: ["2 cups rice flour", "1 tsp yeast"] }];
    expect(checkAllergens(recipes, ["Wheat"])).toEqual([]);
  });

  it("does NOT flag corn tortilla for wheat allergy", () => {
    const recipes = [{ title: "Tacos", ingredients: ["6 corn tortilla", "1 lb ground beef"] }];
    expect(checkAllergens(recipes, ["Wheat"])).toEqual([]);
  });

  it("does NOT flag buckwheat for wheat allergy", () => {
    const recipes = [{ title: "Soba", ingredients: ["8 oz buckwheat noodles", "1 cup broth"] }];
    expect(checkAllergens(recipes, ["Wheat"])).toEqual([]);
  });

  // --- A real allergen next to a false-positive phrase ---

  it("flags almond in coconut almond granola for nut allergy", () => {
    const recipes = [{ title: "Granola", ingredients: ["1 cup coconut almond granola"] }];
    const result = checkAllergens(recipes, ["Nuts"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("almond");
  });

  it("flags eggs listed next to eggplant for egg allergy", () => {
    const recipes = [{ title: "Bake", ingredients: ["eggplant and 2 eggs"] }];
    expect(checkAllergens(recipes, ["Eggs"]).length).toBe(1);
  });

  it("flags cream cheese listed next to peanut butter for milk allergy", () => {
    const recipes = [{ title: "Dip", ingredients: ["peanut butter and cream cheese"] }];
    const result = checkAllergens(recipes, ["Milk"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("cheese");
  });

  it("flags butter listed next to coconut milk for milk allergy", () => {
    const recipes = [{ title: "Sauce", ingredients: ["butter, melted, or coconut milk"] }];
    expect(checkAllergens(recipes, ["Milk"]).length).toBe(1);
  });

  it("flags egg noodles for egg allergy", () => {
    const recipes = [{ title: "Stroganoff", ingredients: ["8 oz egg noodles"] }];
    expect(checkAllergens(recipes, ["Eggs"]).length).toBe(1);
  });

  // --- Multiple allergens ---

  it("checks multiple allergens in one pass", () => {
    const recipes = [
      { title: "Bad Recipe", ingredients: ["1 cup milk", "2 eggs", "1 cup flour"] },
    ];
    const result = checkAllergens(recipes, ["Milk", "Eggs", "Wheat"]);
    const allergens = new Set(result.map((v) => v.allergen));
    expect(allergens.has("Milk")).toBe(true);
    expect(allergens.has("Eggs")).toBe(true);
    expect(allergens.has("Wheat")).toBe(true);
  });

  // --- Multi-recipe scanning ---

  it("scans across multiple recipes", () => {
    const recipes = [
      { title: "Clean Meal", ingredients: ["1 lb chicken", "1 cup rice"] },
      { title: "Nutty Snack", ingredients: ["1/4 cup cashew", "1 apple"] },
    ];
    const result = checkAllergens(recipes, ["Nuts"]);
    expect(result.length).toBe(1);
    expect(result[0].recipeTitle).toBe("Nutty Snack");
  });

  // --- Unknown allergen ---

  it("ignores unknown allergens gracefully", () => {
    const recipes = [{ title: "Test", ingredients: ["1 cup rice"] }];
    expect(checkAllergens(recipes, ["Kiwi"])).toEqual([]);
  });

  // --- Case insensitivity ---

  it("matches case-insensitively", () => {
    const recipes = [{ title: "Salad", ingredients: ["2 oz PARMESAN cheese"] }];
    const result = checkAllergens(recipes, ["Milk"]);
    expect(result.length).toBe(1);
    expect(result[0].matchedKeyword).toBe("cheese"); // "cheese" matches before "parmesan" in keyword list
  });
});
