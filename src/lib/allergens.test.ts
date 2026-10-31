/**
 * Tests for the allergen keyword checker.
 *
 * The checkAllergens function lives in supabase/functions/_shared/allergens.ts
 * (Deno edge function). Since it's pure logic with no Deno-specific deps, we
 * copy-import the core logic here for testing under Vitest.
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline the allergen checker to avoid Deno import issues in Vitest.
// This mirrors supabase/functions/_shared/allergens.ts exactly.
// ---------------------------------------------------------------------------

interface AllergenDef {
  keywords: string[];
  falsePositives?: string[];
}

const ALLERGEN_MAP: Record<string, AllergenDef> = {
  Nuts: {
    keywords: [
      "almond", "walnut", "pecan", "cashew", "pistachio", "hazelnut",
      "macadamia", "pine nut", "brazil nut", "nut butter", "praline",
      "marzipan", "frangipane", "nougat", "chestnut", "filbert",
      "nut milk", "almond milk", "cashew milk", "almond flour",
      "almond butter", "cashew butter",
    ],
    falsePositives: ["butternut", "nutmeg", "coconut", "donut", "doughnut", "water chestnut"],
  },
  Peanuts: {
    keywords: [
      "peanut", "peanut butter", "peanut oil", "groundnut",
      "arachis", "monkey nut",
    ],
  },
  Shellfish: {
    keywords: [
      "shrimp", "prawn", "crab", "lobster", "crawfish", "crayfish",
      "scallop", "mussel", "clam", "oyster", "langoustine", "cockle",
      "abalone", "squid", "calamari", "octopus",
    ],
  },
  Eggs: {
    keywords: [
      "egg", "eggs", "egg white", "egg yolk", "meringue", "mayonnaise",
      "mayo", "aioli", "frittata", "quiche",
    ],
    falsePositives: ["eggplant", "egg noodle"],
  },
  Soy: {
    keywords: [
      "soy", "soy sauce", "soya", "tofu", "tempeh", "edamame",
      "miso", "tamari", "soybean", "soy milk",
    ],
  },
  Wheat: {
    keywords: [
      "wheat", "flour", "bread", "pasta", "noodle", "couscous",
      "bulgur", "farro", "seitan", "panko", "breadcrumb",
      "tortilla", "pita", "naan", "cracker", "croissant",
      "all-purpose flour", "bread flour", "semolina",
    ],
    falsePositives: [
      "rice flour", "almond flour", "coconut flour", "oat flour",
      "chickpea flour", "corn tortilla", "rice noodle",
      "buckwheat",
    ],
  },
  Fish: {
    keywords: [
      "salmon", "tuna", "cod", "tilapia", "halibut", "trout",
      "sardine", "anchovy", "mackerel", "swordfish", "mahi",
      "snapper", "bass", "catfish", "haddock", "sole", "perch",
      "fish sauce", "fish fillet", "white fish", "smoked fish",
    ],
    falsePositives: ["swedish fish", "goldfish cracker"],
  },
  Sesame: {
    keywords: [
      "sesame", "sesame oil", "sesame seed", "tahini", "halva",
      "hummus",
    ],
  },
  Milk: {
    keywords: [
      "milk", "cheese", "butter", "cream", "yogurt", "yoghurt",
      "whey", "casein", "ghee", "ricotta", "mozzarella", "parmesan",
      "cheddar", "feta", "gouda", "brie", "camembert", "gruyère",
      "gruyere", "mascarpone", "cottage cheese", "cream cheese",
      "sour cream", "heavy cream", "half-and-half", "whipped cream",
      "buttermilk", "kefir", "paneer",
    ],
    falsePositives: [
      "coconut milk", "almond milk", "oat milk", "soy milk",
      "cashew milk", "rice milk", "coconut cream", "coconut yogurt",
      "nut butter", "peanut butter", "almond butter", "apple butter",
      "cocoa butter", "shea butter",
    ],
  },
};

interface AllergenViolation {
  allergen: string;
  recipeTitle: string;
  ingredient: string;
  matchedKeyword: string;
}

function checkAllergens(
  recipes: Array<{ title: string; ingredients: string[] }>,
  userAllergens: string[],
): AllergenViolation[] {
  if (!userAllergens || userAllergens.length === 0) return [];

  const violations: AllergenViolation[] = [];

  for (const allergen of userAllergens) {
    const def = ALLERGEN_MAP[allergen];
    if (!def) continue;

    for (const recipe of recipes) {
      for (const ingredient of recipe.ingredients) {
        const lower = ingredient.toLowerCase();

        if (def.falsePositives?.some((fp) => lower.includes(fp))) {
          continue;
        }

        for (const keyword of def.keywords) {
          if (lower.includes(keyword)) {
            violations.push({
              allergen,
              recipeTitle: recipe.title,
              ingredient,
              matchedKeyword: keyword,
            });
            break;
          }
        }
      }
    }
  }

  return violations;
}

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
