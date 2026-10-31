import type { Ingredient } from "@/types/mealPlan";

/**
 * ingredientParser.ts — single source of truth for ingredient parsing.
 *
 * Previously, parsing logic was split between:
 *   - src/services/mealPlanDbService.ts (parseIngredient, parseFraction,
 *     formatQuantity, categorizeAisle, UNIT_ALIASES)
 *   - src/lib/groceryUtils.ts (stripLeadingMeasureAndUnit, singularizeToken,
 *     tokenSet, normalizeIngredientName, ingredientsMatch, COMMON_UNITS)
 *
 * All of that is consolidated here. Both source files now import from this module.
 */

// ---------------------------------------------------------------------------
// Unit aliases — maps raw unit strings to their canonical form.
// Used for parsing ("tablespoons" → "tbsp") and for building the unit-strip
// regex used by normalizeIngredientName.
// ---------------------------------------------------------------------------
export const UNIT_ALIASES: Record<string, string> = {
  cup: "cup", cups: "cup",
  tbsp: "tbsp", tbsps: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tsp: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  g: "g", gram: "g", grams: "g",
  kg: "kg",
  ml: "ml",
  l: "l", liter: "l", liters: "l",
  quart: "quart", quarts: "quart",
  pint: "pint", pints: "pint",
  gallon: "gallon", gallons: "gallon",
  clove: "clove", cloves: "clove",
  slice: "slice", slices: "slice",
  piece: "piece", pieces: "piece",
  bunch: "bunch", bunches: "bunch",
  head: "head", heads: "head",
  stalk: "stalk", stalks: "stalk",
  sprig: "sprig", sprigs: "sprig",
  can: "can", cans: "can",
  package: "package", packages: "package",
  pack: "pack", packs: "pack",
  bag: "bag", bags: "bag",
  container: "container", containers: "container",
  jar: "jar", jars: "jar",
  bottle: "bottle", bottles: "bottle",
  handful: "handful", handfuls: "handful",
  pinch: "pinch", pinches: "pinch",
  dash: "dash", dashes: "dash",
  large: "large", medium: "medium", small: "small", whole: "whole",
};

// ---------------------------------------------------------------------------
// Private constants & helpers
// ---------------------------------------------------------------------------

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 0.25, "½": 0.5, "¾": 0.75,
  "⅓": 0.333, "⅔": 0.667,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

const PARSE_REGEX = /^([\d\s/.,¼½¾⅓⅔⅛⅜⅝⅞]+)?\s*([a-zA-Z]+)?\s+(.+)$/;
const LEADING_MEASURE = /^\s*[\d\s./,¼½¾⅓⅔⅛⅜⅝⅞-]+\s*/;
const LEADING_FILLER = /^(?:some|a little|a bit of|leftover|left over|fresh|extra)\s+/i;
const WRAPPED_PUNCTUATION = /^[^a-z0-9]+|[^a-z0-9]+$/gi;

// Derived from UNIT_ALIASES keys — replaces the separate COMMON_UNITS array
const UNIT_LIST = Object.keys(UNIT_ALIASES);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseFraction(s: string): number {
  let total = 0;
  const trimmed = s.trim();
  for (const [char, val] of Object.entries(UNICODE_FRACTIONS)) {
    if (trimmed.includes(char)) {
      const before = trimmed.replace(char, "").trim();
      return (before ? parseFloat(before) : 0) + val;
    }
  }
  if (trimmed.includes("/")) {
    const parts = trimmed.split(/\s+/);
    for (const part of parts) {
      if (part.includes("/")) {
        const [n, d] = part.split("/").map(Number);
        // Guard against malformed mixed fractions where n or d is NaN
        // (e.g. "1 /2", "2 0/0") — propagating NaN to total would corrupt
        // downstream displayQuantity rendering (WR-03).
        if (d && Number.isFinite(n / d)) total += n / d;
      } else {
        const v = parseFloat(part);
        if (Number.isFinite(v)) total += v;
      }
    }
    return Number.isFinite(total) ? total : 0;
  }
  const direct = parseFloat(trimmed);
  return Number.isFinite(direct) ? direct : 0;
}

function stripLeadingMeasureAndUnit(value: string): string {
  let normalized = value.trim().toLowerCase();
  normalized = normalized.replace(/\([^)]*\)/g, " ");
  normalized = normalized.replace(LEADING_MEASURE, "");
  const unitPattern = new RegExp(`^(?:${UNIT_LIST.map(escapeRegex).join("|")})\\s+`, "i");
  normalized = normalized.replace(unitPattern, "");
  normalized = normalized.replace(/^of\s+/i, "");
  normalized = normalized.replace(LEADING_FILLER, "");
  normalized = normalized.replace(WRAPPED_PUNCTUATION, "");
  return normalized.replace(/\s+/g, " ").trim();
}

/** Words that should never be singularized (ending in "s" naturally). */
const SINGULAR_EXCEPTIONS = new Set([
  "hummus", "couscous", "asparagus", "quinoa", "tahini",
]);

/** Words where the "ves→f" rule does NOT apply (the stem is already correct). */
const VES_EXCEPTIONS = new Set(["olive", "chive"]);

export function singularizeToken(token: string): string {
  if (SINGULAR_EXCEPTIONS.has(token)) return token;
  if (token.endsWith("ies") && token.length > 3) return `${token.slice(0, -3)}y`;
  if (token.endsWith("oes") && token.length > 3) return token.slice(0, -2);
  if (token.endsWith("ses") && token.length > 3) return token.slice(0, -2);
  if (token.endsWith("ves") && token.length > 3) {
    const stem = token.slice(0, -1); // "olives" → "olive"
    if (VES_EXCEPTIONS.has(stem)) return stem;
    return token.slice(0, -3) + "f"; // "leaves" → "leaf", "loaves" → "loaf"
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
  return token;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    stripLeadingMeasureAndUnit(value)
      .split(/[^a-z0-9]+/)
      .map((token) => singularizeToken(token.trim()))
      .filter(Boolean)
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface ParsedIngredient {
  quantity: number;
  unit: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Parse a raw ingredient string like "2 cups flour" or "1/2 tsp salt"
 * into a structured { quantity, unit, name } object.
 */
export function parseIngredient(raw: string): ParsedIngredient {
  const s = raw.trim();

  // Try structured parse: qty + unit + name
  const match = s.match(PARSE_REGEX);
  if (match) {
    const rawQty = match[1]?.trim();
    const rawUnit = match[2]?.trim().toLowerCase();
    const rawName = match[3]?.trim();

    if (rawUnit && rawUnit in UNIT_ALIASES && rawName) {
      return {
        quantity: rawQty ? parseFraction(rawQty) : 1,
        unit: UNIT_ALIASES[rawUnit],
        name: rawName.replace(/^of\s+/i, ""),
      };
    }
  }

  // Fallback: try just qty + name (e.g., "2 lemons")
  const simpleMatch = s.match(/^([\d\s/.,¼½¾⅓⅔⅛⅜⅝⅞]+)\s+(.+)$/);
  if (simpleMatch) {
    return {
      quantity: parseFraction(simpleMatch[1]),
      unit: "",
      name: simpleMatch[2].trim(),
    };
  }

  return { quantity: 0, unit: "", name: s };
}

/**
 * Normalize an ingredient name for comparison — strips leading quantities,
 * units, and filler words, then lowercases. E.g. "2 cups fresh basil" → "basil".
 */
export function normalizeIngredientName(value: string): string {
  return stripLeadingMeasureAndUnit(value);
}

/**
 * Return true if two ingredient strings refer to the same ingredient,
 * using token-set intersection (handles singular/plural, leading measures, etc).
 */
export function ingredientsMatch(left: string, right: string): boolean {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) return false;

  const [smaller, larger] =
    leftTokens.size <= rightTokens.size
      ? [leftTokens, rightTokens]
      : [rightTokens, leftTokens];

  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return true;
}

/**
 * Pluralize a unit string given a numeric quantity. Handles parenthetical-size
 * units (e.g. "can (14 oz)" → "cans (14 oz)") and the NO_PLURAL set for mass
 * units that never pluralize (oz, ml, g, kg, l, dozen).
 *
 * Extracted from formatQuantity so that ingredientToString can reuse the same
 * pluralization logic when rendering via displayQuantity (Plan 07-02).
 */
function pluralizeUnit(qty: number, unit: string): string {
  // Units with parenthetical sizes (e.g. "can (14 oz)") — pluralize the base word
  const parenMatch = unit.match(/^(\w+)\s*(\(.+\))$/);
  if (parenMatch) {
    const [, base, size] = parenMatch;
    const NO_PLURAL_PAREN = ["oz", "ml", "g", "kg", "l"];
    if (qty > 1 && !NO_PLURAL_PAREN.includes(base)) {
      const pluralBase = base.endsWith("ch") || base.endsWith("sh") ? base + "es" : base + "s";
      return `${pluralBase} ${size}`;
    }
    return `${base} ${size}`;
  }

  // Units that never pluralize
  const NO_PLURAL = new Set(["oz", "ml", "g", "kg", "l", "dozen"]);
  if (qty > 1 && !NO_PLURAL.has(unit)) {
    return unit.endsWith("ch") || unit.endsWith("sh") ? unit + "es" : unit + "s";
  }
  return unit;
}

/**
 * Format a quantity + unit into a human-readable string.
 * E.g. formatQuantity(1.5, "cup") → "1.5 cups"
 * E.g. formatQuantity(2, "") → "2"
 */
export function formatQuantity(qty: number, unit: string): string {
  if (qty === 0 && !unit) return "";
  const qtyStr = qty % 1 === 0 ? String(qty) : qty.toFixed(1).replace(/\.0$/, "");
  if (!unit) return qtyStr;
  return `${qtyStr} ${pluralizeUnit(qty, unit)}`;
}

/** Snap target set for toDisplayFraction (D-04 + CONTEXT discretion). Standard
 * kitchen fractions used in recipes. */
const STANDARD_FRACTIONS: Array<[number, string]> = [
  [1 / 8, "1/8"],
  [1 / 4, "1/4"],
  [1 / 3, "1/3"],
  [1 / 2, "1/2"],
  [2 / 3, "2/3"],
  [3 / 4, "3/4"],
];

/** ±tolerance used when snapping a decimal to a standard kitchen fraction. */
const FRACTION_SNAP_TOLERANCE = 0.02;

/**
 * Format a numeric quantity as a human-friendly display string, snapping to
 * standard kitchen fractions when the fractional part is within ±0.02 of
 * {1/8, 1/4, 1/3, 1/2, 2/3, 3/4}. Otherwise falls back to a one-decimal string
 * matching formatQuantity's style. Per D-04 (Ingredient.quantity stays number;
 * display fidelity is a separate field).
 *
 * Examples:
 *   toDisplayFraction(0)     → "0"
 *   toDisplayFraction(2)     → "2"
 *   toDisplayFraction(0.5)   → "1/2"
 *   toDisplayFraction(0.34)  → "1/3"   (within ±0.02 of 1/3)
 *   toDisplayFraction(1.5)   → "1 1/2"
 *   toDisplayFraction(0.37)  → "0.4"   (no snap; decimal fallback)
 */
export function toDisplayFraction(qty: number): string {
  if (qty === 0) return "0";
  if (qty % 1 === 0) return String(qty);
  const whole = Math.floor(qty);
  const frac = qty - whole;
  for (const [value, label] of STANDARD_FRACTIONS) {
    if (Math.abs(frac - value) <= FRACTION_SNAP_TOLERANCE) {
      return whole === 0 ? label : `${whole} ${label}`;
    }
  }
  return qty.toFixed(1).replace(/\.0$/, "");
}

/** Capitalize first letter — used when building display strings. */
export { capitalize };

/**
 * Convert a raw unknown value (flat string or structured object) into an Ingredient.
 * - string: delegates to parseIngredient(), maps fields
 * - object with name field: passes through with numeric coercion on quantity
 * - anything else: fallback { quantity: 0, unit: "", name: String(raw) }
 */
/**
 * Strip a trailing ", from Monday dinner" / "from yesterday breakfast" /
 * etc. suffix that GPT-4.1-mini sometimes appends to ingredient names to
 * imply a leftover source. The structural source link belongs in
 * MealRecipe.source_meal_id (validated by mealPlanValidation), not in the
 * ingredient string. This cleaner runs at normalize time so the
 * shopping-list builder and display layer never see the suffix.
 */
const INGREDIENT_FROM_DAY_SUFFIX_RE =
  /,?\s+from\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|yesterday|previous\s+day)(?:'s)?\s+(?:breakfast|lunch|dinner|snack)\s*$/i;

/**
 * Shared cleaner for the ", from <day> <meal>" leftover-source suffix. Used at
 * ingredient-normalize time here and by mealPlanParser. Single source of truth
 * for the regex so the two client parsers can't drift.
 */
export function stripIngredientSourceSuffix(name: string): string {
  return name.replace(INGREDIENT_FROM_DAY_SUFFIX_RE, "").trim();
}

export function normalizeIngredient(raw: unknown): Ingredient {
  if (typeof raw === "string") {
    const parsed = parseIngredient(raw);
    return {
      quantity: parsed.quantity,
      unit: parsed.unit,
      name: stripIngredientSourceSuffix(parsed.name),
      displayQuantity: toDisplayFraction(parsed.quantity),
    };
  }
  if (raw && typeof raw === "object" && "name" in raw) {
    const obj = raw as Record<string, unknown>;
    const rawQty = obj.quantity;
    let quantity: number;
    if (typeof rawQty === "number") {
      quantity = rawQty;
    } else if (typeof rawQty === "string") {
      quantity = parseFraction(rawQty);
    } else {
      quantity = 0;
    }
    const rawUnit = typeof obj.unit === "string" ? obj.unit : "";
    const rawName =
      typeof obj.name === "string" ? obj.name : String(obj.name);
    return {
      quantity,
      unit: UNIT_ALIASES[rawUnit.toLowerCase()] ?? rawUnit,
      name: stripIngredientSourceSuffix(rawName),
      displayQuantity: toDisplayFraction(quantity),
      ...(typeof obj.prep === "string" ? { prep: obj.prep } : {}),
    };
  }
  return { quantity: 0, unit: "", name: String(raw) };
}

/**
 * Render a structured Ingredient to a human-readable display string.
 * E.g. { quantity: 2, unit: "lb", name: "chicken thighs", prep: "minced" }
 *   → "2 lbs chicken thighs, minced"
 * Zero-quantity, no-unit items render as just the name (with optional prep note).
 */
export function ingredientToString(ing: Ingredient): string {
  const qtyUnit = ing.displayQuantity && ing.displayQuantity !== "0"
    ? (ing.unit ? `${ing.displayQuantity} ${pluralizeUnit(ing.quantity, ing.unit)}` : ing.displayQuantity)
    : formatQuantity(ing.quantity, ing.unit);
  const base = qtyUnit ? `${qtyUnit} ${ing.name}` : ing.name;
  return ing.prep ? `${base}, ${ing.prep}` : base;
}

/**
 * Normalize an array of raw unknown values (flat strings or structured objects)
 * to Ingredient[]. Safe for use with any JSONB array from the database.
 */
export function asIngredients(val: unknown): Ingredient[] {
  if (!Array.isArray(val)) return [];
  return val.map(normalizeIngredient);
}

/**
 * Compound-match rules checked FIRST — these override the generic keyword map
 * to prevent greedy single-word matches (e.g. "almond butter" matching "almond"
 * before it can match "butter" in Dairy).
 */
const COMPOUND_AISLE_RULES: Array<{ pattern: string; aisle: string }> = [
  // Nut butters → Oils & Condiments (bought by the jar)
  { pattern: "almond butter", aisle: "Oils & Condiments" },
  { pattern: "cashew butter", aisle: "Oils & Condiments" },
  { pattern: "peanut butter", aisle: "Oils & Condiments" },
  { pattern: "nut butter", aisle: "Oils & Condiments" },
  // Plant milks → Dairy & Eggs
  { pattern: "almond milk", aisle: "Dairy & Eggs" },
  { pattern: "oat milk", aisle: "Dairy & Eggs" },
  { pattern: "coconut milk", aisle: "Canned & Jarred" },
  { pattern: "soy milk", aisle: "Dairy & Eggs" },
  // Almond flour → Grains & Pasta
  { pattern: "almond flour", aisle: "Grains & Pasta" },
  // Dried herbs/spices → Spices & Seasonings (before Produce catches "oregano")
  { pattern: "dried oregano", aisle: "Spices & Seasonings" },
  { pattern: "dried thyme", aisle: "Spices & Seasonings" },
  { pattern: "dried dill", aisle: "Spices & Seasonings" },
  { pattern: "dried basil", aisle: "Spices & Seasonings" },
  { pattern: "dried parsley", aisle: "Spices & Seasonings" },
  { pattern: "dried rosemary", aisle: "Spices & Seasonings" },
  { pattern: "dried mint", aisle: "Spices & Seasonings" },
  { pattern: "dried sage", aisle: "Spices & Seasonings" },
  { pattern: "dried cilantro", aisle: "Spices & Seasonings" },
  { pattern: "garlic powder", aisle: "Spices & Seasonings" },
  { pattern: "onion powder", aisle: "Spices & Seasonings" },
  { pattern: "ground cumin", aisle: "Spices & Seasonings" },
  { pattern: "ground coriander", aisle: "Spices & Seasonings" },
  { pattern: "ground cinnamon", aisle: "Spices & Seasonings" },
  { pattern: "ground turmeric", aisle: "Spices & Seasonings" },
  { pattern: "smoked paprika", aisle: "Spices & Seasonings" },
  { pattern: "red pepper flake", aisle: "Spices & Seasonings" },
  // Black pepper → Spices (before Produce's "pepper" keyword fires)
  { pattern: "black pepper", aisle: "Spices & Seasonings" },
  { pattern: "white pepper", aisle: "Spices & Seasonings" },
  { pattern: "italian seasoning", aisle: "Spices & Seasonings" },
  { pattern: "chili flake", aisle: "Spices & Seasonings" },
  { pattern: "chili powder", aisle: "Spices & Seasonings" },
  { pattern: "italian herb", aisle: "Spices & Seasonings" },
  { pattern: "mixed herb", aisle: "Spices & Seasonings" },
  // Vinegars → Oils & Condiments (before Produce catches "apple", Grains catches "rice")
  { pattern: "apple cider vinegar", aisle: "Oils & Condiments" },
  { pattern: "rice vinegar", aisle: "Oils & Condiments" },
  { pattern: "rice wine", aisle: "Oils & Condiments" },
  { pattern: "balsamic vinegar", aisle: "Oils & Condiments" },
  { pattern: "balsamic glaze", aisle: "Oils & Condiments" },
  // Liquid sweeteners / sugar substitutes — bought by the bottle like a condiment
  { pattern: "stevia", aisle: "Oils & Condiments" },
  { pattern: "monk fruit", aisle: "Oils & Condiments" },
  // Mixed greens / salad greens → Produce (before "mixed" falls through to Other)
  { pattern: "mixed greens", aisle: "Produce" },
  { pattern: "salad greens", aisle: "Produce" },
  // Cornstarch → Snacks & Dry Goods (before Produce catches "corn")
  { pattern: "cornstarch", aisle: "Snacks & Dry Goods" },
  // Tomato paste → Canned & Jarred
  { pattern: "tomato paste", aisle: "Canned & Jarred" },
  // Cream cheese → Dairy (before "cream" matches Oils)
  { pattern: "cream cheese", aisle: "Dairy & Eggs" },
  { pattern: "sour cream", aisle: "Dairy & Eggs" },
  // Bell pepper → Produce (before "pepper" matches Spices)
  { pattern: "bell pepper", aisle: "Produce" },
  // Mayonnaise → Oils & Condiments (before "avocado" in Produce catches "avocado oil mayo")
  { pattern: "mayonnaise", aisle: "Oils & Condiments" },
  { pattern: "mayo", aisle: "Oils & Condiments" },
  // Avocado oil → Oils & Condiments (before "avocado" in Produce)
  { pattern: "avocado oil", aisle: "Oils & Condiments" },
  // Crushed/canned tomatoes → Canned & Jarred (before "tomato" fires in Produce)
  { pattern: "crushed tomato", aisle: "Canned & Jarred" },
  { pattern: "can crushed", aisle: "Canned & Jarred" },
  { pattern: "can diced", aisle: "Canned & Jarred" },
  { pattern: "canned tomato", aisle: "Canned & Jarred" },
  // Brussels sprouts → Produce
  { pattern: "brussels sprout", aisle: "Produce" },
  // Dried chives → Spices & Seasonings
  { pattern: "dried chive", aisle: "Spices & Seasonings" },
  // Fennel seeds → Spices & Seasonings
  { pattern: "fennel seed", aisle: "Spices & Seasonings" },
  // Shredded/unsweetened coconut → Snacks & Dry Goods (before "coconut" falls to Other)
  { pattern: "shredded coconut", aisle: "Snacks & Dry Goods" },
  { pattern: "unsweetened coconut", aisle: "Snacks & Dry Goods" },
  { pattern: "desiccated coconut", aisle: "Snacks & Dry Goods" },
];

const AISLE_MAP: Record<string, string[]> = {
  "Produce": ["lettuce", "tomato", "onion", "garlic", "pepper", "cucumber", "carrot", "spinach", "kale", "arugula", "avocado", "lemon", "lime", "orange", "apple", "banana", "berry", "blackberry", "blueberry", "strawberry", "raspberry", "grape", "mango", "pineapple", "peach", "pear", "melon", "watermelon", "zucchini", "squash", "broccoli", "cauliflower", "celery", "mushroom", "potato", "sweet potato", "corn", "eggplant", "cabbage", "beet", "radish", "asparagus", "artichoke", "leek", "shallot", "ginger", "herb", "basil", "cilantro", "parsley", "mint", "rosemary", "thyme", "dill", "chive", "oregano", "sage", "scallion", "green onion", "jalapeño", "serrano", "habanero", "bell pepper", "chili"],
  "Meat & Seafood": ["chicken", "beef", "pork", "turkey", "lamb", "steak", "ground beef", "ground lamb", "ground turkey", "sausage", "bacon", "ham", "salmon", "shrimp", "fish", "tuna", "cod", "tilapia", "crab", "lobster", "scallop", "prawn", "anchovy"],
  "Dairy & Eggs": ["milk", "cheese", "yogurt", "butter", "cream", "egg", "sour cream", "cottage cheese", "ricotta", "mozzarella", "parmesan", "cheddar", "feta", "goat cheese", "cream cheese", "whipped cream", "half and half", "halloumi", "paneer", "kefir"],
  "Bakery & Bread": ["bread", "tortilla", "pita", "naan", "bagel", "roll", "bun", "croissant", "flatbread", "wrap", "english muffin", "baguette"],
  "Grains & Pasta": ["rice", "pasta", "quinoa", "oat", "couscous", "barley", "farro", "noodle", "spaghetti", "penne", "orzo", "bulgur", "polenta", "cornmeal", "flour", "breadcrumb"],
  "Canned & Jarred": ["canned", "tomato sauce", "tomato paste", "diced tomato", "crushed tomato", "broth", "stock", "coconut milk", "beans", "chickpea", "lentil", "olives", "capers", "artichoke hearts", "sun-dried", "pesto", "hummus"],
  "Oils & Condiments": ["oil", "olive oil", "vinegar", "soy sauce", "hot sauce", "mustard", "ketchup", "mayo", "mayonnaise", "dressing", "tahini", "sriracha", "worcestershire", "fish sauce", "sesame oil", "coconut oil", "almond butter", "peanut butter", "cashew butter"],
  "Spices & Seasonings": ["salt", "pepper", "cumin", "paprika", "turmeric", "cinnamon", "nutmeg", "cayenne", "chili powder", "garlic powder", "onion powder", "oregano dried", "bay leaf", "coriander", "cardamom", "clove", "allspice", "curry", "za'atar", "sumac", "red pepper flake"],
  "Nuts & Seeds": ["almond", "walnut", "pecan", "cashew", "pistachio", "peanut", "pine nut", "sunflower", "pumpkin seed", "sesame seed", "chia", "flax", "hemp seed", "hazelnut", "macadamia", "slivered almond"],
  "Frozen": ["frozen"],
  "Snacks & Dry Goods": ["honey", "maple syrup", "sugar", "brown sugar", "cocoa", "chocolate", "vanilla", "cornstarch", "baking powder", "baking soda", "yeast", "coconut"],
};

/** Cache compiled regexes for aisle keywords (left-boundary match). */
const AISLE_KEYWORD_REGEXES = new Map<string, RegExp>();

function matchesKeyword(text: string, keyword: string): boolean {
  let re = AISLE_KEYWORD_REGEXES.get(keyword);
  if (!re) {
    // Left-side word boundary only — allows "tomato" to match "tomatoes"
    // but prevents "sage" from matching inside "sausage".
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`\\b${escaped}`);
    AISLE_KEYWORD_REGEXES.set(keyword, re);
  }
  return re.test(text);
}

/**
 * Categorize an ingredient name into a grocery aisle.
 * Compound rules are checked first to prevent greedy single-word matches.
 * Single-word keywords use left-boundary regex (\bkw) to prevent substring
 * false positives (e.g. "sage" inside "sausage").
 * Keywords are also matched against a singularized form of the name to handle
 * plurals (e.g. "berry" matches "berries" via singularized "berry").
 */
export function categorizeAisle(name: string): string {
  const lower = name.toLowerCase();

  // Check compound rules first (multi-word patterns take priority)
  for (const rule of COMPOUND_AISLE_RULES) {
    if (lower.includes(rule.pattern)) return rule.aisle;
  }

  // Singularize each word so keywords like "berry" match "berries"
  const singularized = lower.split(/\s+/).map(singularizeToken).join(" ");

  for (const [aisle, keywords] of Object.entries(AISLE_MAP)) {
    if (keywords.some((kw) => matchesKeyword(lower, kw) || matchesKeyword(singularized, kw))) return aisle;
  }
  return "Other";
}
