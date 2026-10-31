import { describe, it, expect } from "vitest";
import {
  parseIngredient,
  normalizeIngredientName,
  ingredientsMatch,
  formatQuantity,
  toDisplayFraction,
  categorizeAisle,
  normalizeIngredient,
  ingredientToString,
  parseFraction,
} from "./ingredientParser";

describe("parseIngredient", () => {
  it('parses "2 cups flour"', () => {
    const r = parseIngredient("2 cups flour");
    expect(r.quantity).toBe(2);
    expect(r.unit).toBe("cup");
    expect(r.name).toBe("flour");
  });

  it('parses fraction "1/2 tsp salt"', () => {
    const r = parseIngredient("1/2 tsp salt");
    expect(r.quantity).toBeCloseTo(0.5);
    expect(r.unit).toBe("tsp");
    expect(r.name).toBe("salt");
  });

  it('parses mixed fraction "1 1/2 cups milk"', () => {
    const r = parseIngredient("1 1/2 cups milk");
    expect(r.quantity).toBeCloseTo(1.5);
    expect(r.unit).toBe("cup");
  });

  it("parses unicode fraction ½", () => {
    const r = parseIngredient("½ cup olive oil");
    expect(r.quantity).toBeCloseTo(0.5);
    expect(r.unit).toBe("cup");
    expect(r.name).toBe("olive oil");
  });

  it('parses no-unit "2 lemons"', () => {
    const r = parseIngredient("2 lemons");
    expect(r.quantity).toBe(2);
    expect(r.unit).toBe("");
    expect(r.name).toBe("lemons");
  });

  it('handles bare ingredient "salt to taste"', () => {
    const r = parseIngredient("salt to taste");
    expect(r.quantity).toBe(0);
    expect(r.name).toContain("salt");
  });

  it("normalizes unit aliases — tablespoon → tbsp", () => {
    const r = parseIngredient("2 tablespoons olive oil");
    expect(r.unit).toBe("tbsp");
  });

  it("strips leading 'of' from name", () => {
    const r = parseIngredient("1 cup of quinoa");
    expect(r.name).toBe("quinoa");
  });
});

describe("normalizeIngredientName", () => {
  it("strips leading quantity and unit", () => {
    expect(normalizeIngredientName("2 cups fresh basil")).toBe("basil");
  });

  it("strips parenthetical info", () => {
    expect(normalizeIngredientName("chicken breast (boneless)")).toBe("chicken breast");
  });

  it("strips leading filler word", () => {
    // Only the first leading filler is stripped — "some fresh parsley" → "fresh parsley"
    // because "fresh" is not leading after "some" is removed
    expect(normalizeIngredientName("some parsley")).toBe("parsley");
    expect(normalizeIngredientName("fresh basil")).toBe("basil");
  });

  it("lowercases", () => {
    expect(normalizeIngredientName("Olive Oil")).toBe("olive oil");
  });

  it("handles empty string", () => {
    expect(normalizeIngredientName("")).toBe("");
  });
});

describe("ingredientsMatch", () => {
  it("matches ingredient with quantity prefix", () => {
    expect(ingredientsMatch("olive oil", "2 tbsp olive oil")).toBe(true);
  });

  it("matches singular and plural", () => {
    expect(ingredientsMatch("tomatoes", "tomato")).toBe(true);
  });

  it("matches with different quantities", () => {
    expect(ingredientsMatch("garlic cloves", "3 cloves garlic")).toBe(true);
  });

  it("does not match different ingredients", () => {
    expect(ingredientsMatch("chicken breast", "chicken thigh")).toBe(false);
  });

  it("returns false for empty strings", () => {
    expect(ingredientsMatch("", "olive oil")).toBe(false);
    expect(ingredientsMatch("olive oil", "")).toBe(false);
  });
});

describe("formatQuantity", () => {
  it("formats whole number with unit", () => {
    expect(formatQuantity(2, "cup")).toBe("2 cups");
  });

  it("formats singular unit", () => {
    expect(formatQuantity(1, "cup")).toBe("1 cup");
  });

  it("formats decimal", () => {
    expect(formatQuantity(1.5, "cup")).toBe("1.5 cups");
  });

  it("returns just number when no unit", () => {
    expect(formatQuantity(3, "")).toBe("3");
  });

  it("returns empty string for zero with no unit", () => {
    expect(formatQuantity(0, "")).toBe("");
  });

  it("does not pluralize mass units (oz, g, ml)", () => {
    expect(formatQuantity(2, "oz")).toBe("2 oz");
    expect(formatQuantity(100, "g")).toBe("100 g");
    expect(formatQuantity(250, "ml")).toBe("250 ml");
  });
});

describe("toDisplayFraction", () => {
  it('returns "0" for zero', () => {
    expect(toDisplayFraction(0)).toBe("0");
  });

  it('returns whole number string for 2', () => {
    expect(toDisplayFraction(2)).toBe("2");
  });

  it('returns "3" for 3', () => {
    expect(toDisplayFraction(3)).toBe("3");
  });

  it('snaps 0.25 to "1/4"', () => {
    expect(toDisplayFraction(0.25)).toBe("1/4");
  });

  it('snaps 0.5 to "1/2"', () => {
    expect(toDisplayFraction(0.5)).toBe("1/2");
  });

  it('snaps 0.333 to "1/3" (within tolerance)', () => {
    expect(toDisplayFraction(0.333)).toBe("1/3");
  });

  it('snaps 0.34 to "1/3" (within ±0.02 tolerance)', () => {
    expect(toDisplayFraction(0.34)).toBe("1/3");
  });

  it('snaps 0.667 to "2/3"', () => {
    expect(toDisplayFraction(0.667)).toBe("2/3");
  });

  it('snaps 0.75 to "3/4"', () => {
    expect(toDisplayFraction(0.75)).toBe("3/4");
  });

  it('snaps 0.125 to "1/8"', () => {
    expect(toDisplayFraction(0.125)).toBe("1/8");
  });

  it('returns mixed form "1 1/2" for 1.5', () => {
    expect(toDisplayFraction(1.5)).toBe("1 1/2");
  });

  it('returns mixed form "2 1/4" for 2.25', () => {
    expect(toDisplayFraction(2.25)).toBe("2 1/4");
  });

  it('falls back to decimal "0.4" for 0.37 (no snap)', () => {
    expect(toDisplayFraction(0.37)).toBe("0.4");
  });

  it('falls back to decimal "0.4" for 0.4 (no snap)', () => {
    expect(toDisplayFraction(0.4)).toBe("0.4");
  });
});

describe("categorizeAisle", () => {
  it("categorizes chicken as Meat & Seafood", () => {
    expect(categorizeAisle("chicken breast")).toBe("Meat & Seafood");
  });

  it("categorizes olive oil as Oils & Condiments", () => {
    expect(categorizeAisle("olive oil")).toBe("Oils & Condiments");
  });

  it("categorizes pasta as Grains & Pasta", () => {
    expect(categorizeAisle("penne pasta")).toBe("Grains & Pasta");
  });

  it("categorizes tomato as Produce", () => {
    expect(categorizeAisle("cherry tomatoes")).toBe("Produce");
  });

  it("falls back to Other for unknowns", () => {
    expect(categorizeAisle("dragon fruit extract")).toBe("Other");
  });

  // --- RC3: left-boundary matching prevents substring false positives ---
  it("does NOT match 'sage' inside 'sausage' → Meat, not Produce", () => {
    expect(categorizeAisle("mild Italian sausage")).toBe("Meat & Seafood");
  });

  it("still matches 'sage' as a standalone herb → Produce", () => {
    expect(categorizeAisle("fresh sage")).toBe("Produce");
  });

  it("categorizes 'chili powder' as Spices via compound rule", () => {
    expect(categorizeAisle("chili powder")).toBe("Spices & Seasonings");
  });

  it("categorizes 'italian herbs' as Spices via compound rule", () => {
    expect(categorizeAisle("italian herbs")).toBe("Spices & Seasonings");
  });

  it("categorizes 'apple cider vinegar' as Oils & Condiments via compound rule", () => {
    expect(categorizeAisle("apple cider vinegar")).toBe("Oils & Condiments");
  });

  it("categorizes 'rice vinegar' as Oils & Condiments via compound rule", () => {
    expect(categorizeAisle("rice vinegar")).toBe("Oils & Condiments");
  });

  it("categorizes 'balsamic glaze' as Oils & Condiments via compound rule", () => {
    expect(categorizeAisle("balsamic glaze")).toBe("Oils & Condiments");
  });

  it("categorizes 'mixed greens' as Produce via compound rule", () => {
    expect(categorizeAisle("mixed greens")).toBe("Produce");
  });

  it("categorizes 'cornstarch' as Snacks & Dry Goods via compound rule", () => {
    expect(categorizeAisle("cornstarch")).toBe("Snacks & Dry Goods");
  });

  // Existing substring matches still work with left-boundary
  it("still matches plurals: 'tomatoes' → Produce", () => {
    expect(categorizeAisle("roma tomatoes")).toBe("Produce");
  });

  it("still matches 'sausage' → Meat & Seafood", () => {
    expect(categorizeAisle("chicken sausage")).toBe("Meat & Seafood");
  });
});

describe("parseFraction (exported)", () => {
  it("parses integer string", () => {
    expect(parseFraction("3")).toBe(3);
  });

  it("parses slash fraction", () => {
    expect(parseFraction("1/2")).toBeCloseTo(0.5);
  });

  it("parses mixed fraction", () => {
    expect(parseFraction("1 1/2")).toBeCloseTo(1.5);
  });

  it("parses unicode fraction ½", () => {
    expect(parseFraction("½")).toBeCloseTo(0.5);
  });
});

describe("normalizeIngredient", () => {
  it("converts flat string to Ingredient", () => {
    const r = normalizeIngredient("2 cups flour");
    expect(r.quantity).toBe(2);
    expect(r.unit).toBe("cup");
    expect(r.name).toBe("flour");
  });

  it("passes through a structured object unchanged", () => {
    const r = normalizeIngredient({ name: "garlic", quantity: 3, unit: "clove" });
    expect(r.quantity).toBe(3);
    expect(r.unit).toBe("clove");
    expect(r.name).toBe("garlic");
  });

  it("coerces string quantity on structured object via parseFraction", () => {
    const r = normalizeIngredient({ name: "flour", quantity: "1 1/2", unit: "cup" });
    expect(r.quantity).toBeCloseTo(1.5);
    expect(r.unit).toBe("cup");
    expect(r.name).toBe("flour");
  });

  it("passes through prep field when present", () => {
    const r = normalizeIngredient({ name: "chicken thighs", quantity: 1.5, unit: "lb", prep: "minced" });
    expect(r.prep).toBe("minced");
  });

  it("falls back gracefully for non-string, non-object input", () => {
    const r = normalizeIngredient(42);
    expect(r.quantity).toBe(0);
    expect(r.unit).toBe("");
    expect(r.name).toBe("42");
  });

  it("handles bare string 'salt to taste'", () => {
    const r = normalizeIngredient("salt to taste");
    expect(r.quantity).toBe(0);
    expect(r.name).toContain("salt");
  });

  // --- Plan 07-02: displayQuantity is populated on every non-degenerate path ---
  it("populates displayQuantity from object with fractional quantity", () => {
    const r = normalizeIngredient({ name: "feta", quantity: 0.5, unit: "cup" });
    expect(r.displayQuantity).toBe("1/2");
  });

  it("populates displayQuantity from string parse with mixed fraction", () => {
    const r = normalizeIngredient("1.5 cups flour");
    expect(r.displayQuantity).toBe("1 1/2");
  });

  it("populates displayQuantity as whole-number string for integer quantity", () => {
    const r = normalizeIngredient({ name: "garlic", quantity: 3, unit: "clove" });
    expect(r.displayQuantity).toBe("3");
  });

  it("omits displayQuantity on degenerate fallback (non-string, non-object)", () => {
    const r = normalizeIngredient(42);
    expect(r.displayQuantity).toBeUndefined();
  });
});

describe("ingredientToString", () => {
  it("renders quantity + unit + name", () => {
    expect(ingredientToString({ quantity: 2, unit: "cup", name: "flour" })).toBe("2 cups flour");
  });

  it("renders without unit", () => {
    expect(ingredientToString({ quantity: 2, unit: "", name: "lemons" })).toBe("2 lemons");
  });

  it("renders zero-quantity with no unit as just name", () => {
    expect(ingredientToString({ quantity: 0, unit: "", name: "salt to taste" })).toBe("salt to taste");
  });

  it("appends prep as comma-separated note", () => {
    expect(ingredientToString({ quantity: 1.5, unit: "lb", name: "chicken thighs", prep: "minced" })).toBe("1.5 lbs chicken thighs, minced");
  });

  it("renders zero-quantity name with prep", () => {
    expect(ingredientToString({ quantity: 0, unit: "", name: "salt", prep: "to taste" })).toBe("salt, to taste");
  });

  // --- Plan 07-02: prefer displayQuantity when present; fall back to formatQuantity ---
  it("prefers displayQuantity for fractional qty ≤ 1 (no pluralization)", () => {
    expect(
      ingredientToString({ name: "feta", quantity: 0.5, unit: "cup", displayQuantity: "1/2" }),
    ).toBe("1/2 cup feta");
  });

  it("prefers displayQuantity and pluralizes via numeric quantity for qty > 1", () => {
    expect(
      ingredientToString({ name: "tomatoes", quantity: 1.5, unit: "cup", displayQuantity: "1 1/2" }),
    ).toBe("1 1/2 cups tomatoes");
  });

  it("falls back to formatQuantity when displayQuantity missing (older saved plans)", () => {
    expect(ingredientToString({ name: "olive oil", quantity: 2, unit: "tbsp" })).toBe(
      "2 tbsps olive oil",
    );
  });

  it("renders displayQuantity + prep suffix", () => {
    expect(
      ingredientToString({
        name: "chicken",
        quantity: 1.5,
        unit: "lb",
        displayQuantity: "1 1/2",
        prep: "diced",
      }),
    ).toBe("1 1/2 lbs chicken, diced");
  });

  it("uses displayQuantity alone when unit is empty", () => {
    expect(
      ingredientToString({ name: "lemons", quantity: 2, unit: "", displayQuantity: "2" }),
    ).toBe("2 lemons");
  });

  // Regression: normalizeIngredient produces displayQuantity: toDisplayFraction(0) === "0"
  // for a to-taste ingredient. That "0" string is truthy, so it used to short-circuit
  // past formatQuantity's qty===0 blank-out and render "0 kosher salt".
  it("treats displayQuantity '0' as absent — renders name-only, not '0 kosher salt'", () => {
    expect(
      ingredientToString({ quantity: 0, unit: "", name: "kosher salt", displayQuantity: "0" }),
    ).toBe("kosher salt");
  });
});
