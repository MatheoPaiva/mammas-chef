/**
 * Allergen keyword checker — scans recipe ingredients for allergen violations.
 *
 * Covers the 9 allergen options from the app: Nuts, Peanuts, Shellfish, Eggs,
 * Soy, Wheat, Fish, Sesame, Milk.
 */

// ---------------------------------------------------------------------------
// Allergen → ingredient keyword map
// ---------------------------------------------------------------------------

/** Each entry: allergen name → { keywords to match, falsePositives to exclude } */
interface AllergenDef {
  keywords: string[];
  /** Substrings that would falsely trigger a keyword match. */
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
      "buckwheat",  // buckwheat is NOT wheat
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
      "hummus",  // hummus contains tahini
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AllergenViolation {
  allergen: string;
  recipeTitle: string;
  ingredient: string;
  matchedKeyword: string;
}

// ---------------------------------------------------------------------------
// Core check
// ---------------------------------------------------------------------------

/**
 * Scan a list of recipes for allergen violations.
 *
 * @param recipes - Array of { title, ingredients: Array<{ name: string }> }
 * @param userAllergens - Allergen names from the user's profile (e.g. ["Nuts", "Milk"])
 * @returns Array of violations found (empty = clean)
 */
export function checkAllergens(
  recipes: Array<{ title: string; ingredients: Array<{ name: string }> }>,
  userAllergens: string[],
): AllergenViolation[] {
  if (!userAllergens || userAllergens.length === 0) return [];

  const violations: AllergenViolation[] = [];

  for (const requested of userAllergens) {
    // Case-insensitive: the website saves "Sesame", but CLI/agent callers may send "sesame".
    const allergen = Object.keys(ALLERGEN_MAP).find((k) => k.toLowerCase() === requested.trim().toLowerCase());
    if (!allergen) continue; // Unknown allergen — skip (prompt still blocks it)
    const def = ALLERGEN_MAP[allergen];

    for (const recipe of recipes) {
      for (const ingredient of recipe.ingredients) {
        const lower = ingredient.name.toLowerCase();

        // Check false positives first — if the ingredient matches a false
        // positive, skip this ingredient entirely for this allergen
        if (def.falsePositives?.some((fp) => lower.includes(fp))) {
          continue;
        }

        // Check keywords
        for (const keyword of def.keywords) {
          if (lower.includes(keyword)) {
            violations.push({
              allergen,
              recipeTitle: recipe.title,
              ingredient: ingredient.name,
              matchedKeyword: keyword,
            });
            break; // One match per ingredient is enough
          }
        }
      }
    }
  }

  return violations;
}

/**
 * Put a visible warning on every meal with an allergen violation. It is stored
 * with the meal, so it shows on the plan and stays there after a reload.
 */
export function markAllergenCautions(
  meals: Array<{ title?: unknown; cautionNote?: unknown }>,
  violations: AllergenViolation[],
): void {
  for (const meal of meals) {
    const allergens = [...new Set(violations.filter((v) => v.recipeTitle === meal.title).map((v) => v.allergen))];
    if (allergens.length === 0) continue;
    const note = `Allergy warning: may contain ${allergens.join(", ")}. Check every ingredient before cooking.`;
    meal.cautionNote = typeof meal.cautionNote === "string" && meal.cautionNote ? `${note} ${meal.cautionNote}` : note;
  }
}
