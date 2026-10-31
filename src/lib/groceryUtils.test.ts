import { describe, it, expect } from "vitest";
import {
  normalizeGroceryItems,
  applyPantryStatus,
  extractPantryItemsFromPrompt,
} from "./groceryUtils";

// ---------------------------------------------------------------------------
// normalizeGroceryItems — Phase 17 Plan 03, D-20 whitelist fix
// ---------------------------------------------------------------------------

describe("normalizeGroceryItems", () => {
  it("returns an empty array for null/undefined input", () => {
    expect(normalizeGroceryItems(null)).toEqual([]);
    expect(normalizeGroceryItems(undefined)).toEqual([]);
  });

  it("filters out items missing a string name or quantity", () => {
    const result = normalizeGroceryItems([
      { name: "Rice", quantity: "2 lbs" },
      { name: "Flour" }, // missing quantity
      { quantity: "1 cup" } as Partial<{ name: string; quantity: string }>, // missing name
    ]);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("Rice");
  });

  it("passes item.sources through when it is an array (D-18 traceability)", () => {
    const sources = [{ mealId: "meal-1", title: "Lemon Chicken", day: "Monday", mealType: "dinner" }];
    const result = normalizeGroceryItems([
      { name: "Chicken breast", quantity: "2 lbs", sources },
    ]);
    expect(result[0].sources).toEqual(sources);
  });

  it("rejects a malformed (non-array) sources value, yielding sources: undefined", () => {
    const result = normalizeGroceryItems([
      // @ts-expect-error — intentionally malformed for the whitelist-rejection test
      { name: "Chicken breast", quantity: "2 lbs", sources: "not-an-array" },
    ]);
    expect(result[0].sources).toBeUndefined();
  });

  it("leaves sources undefined when absent from the input item", () => {
    const result = normalizeGroceryItems([{ name: "Rice", quantity: "2 lbs" }]);
    expect(result[0].sources).toBeUndefined();
  });

  it("passes item.pantry through when it is exactly true (pre-existing gap fixed)", () => {
    const result = normalizeGroceryItems([
      { name: "Olive oil", quantity: "", pantry: true },
    ]);
    expect(result[0].pantry).toBe(true);
  });

  it("rejects truthy-but-not-true pantry values, yielding pantry: undefined", () => {
    const result = normalizeGroceryItems([
      // @ts-expect-error — intentionally malformed for the whitelist-rejection test
      { name: "Olive oil", quantity: "", pantry: "yes" },
    ]);
    expect(result[0].pantry).toBeUndefined();
  });

  it("leaves pantry undefined when absent from the input item", () => {
    const result = normalizeGroceryItems([{ name: "Rice", quantity: "2 lbs" }]);
    expect(result[0].pantry).toBeUndefined();
  });

  // --- Existing-behavior regression (unchanged by the D-20 fix) ---
  it("REGRESSION: defaults status to 'needed' unless explicitly 'on_hand'", () => {
    const result = normalizeGroceryItems([
      { name: "Rice", quantity: "2 lbs" },
      { name: "Flour", quantity: "1 lb", status: "on_hand" },
      // @ts-expect-error — intentionally invalid status for the whitelist-rejection test
      { name: "Sugar", quantity: "1 lb", status: "bogus" },
    ]);
    expect(result[0].status).toBe("needed");
    expect(result[1].status).toBe("on_hand");
    expect(result[2].status).toBe("needed");
  });

  it("REGRESSION: falls back to categorizeAisle when item.aisle is missing", () => {
    const result = normalizeGroceryItems([{ name: "Chicken breast", quantity: "2 lbs" }]);
    expect(result[0].aisle).toBe("Meat & Seafood");
  });

  it("REGRESSION: preserves an explicit aisle string over categorizeAisle", () => {
    const result = normalizeGroceryItems([
      { name: "Chicken breast", quantity: "2 lbs", aisle: "Custom Aisle" },
    ]);
    expect(result[0].aisle).toBe("Custom Aisle");
  });

  it("REGRESSION: strips the item name from a trailing quantity string", () => {
    const result = normalizeGroceryItems([{ name: "cilantro", quantity: "1 bunch cilantro" }]);
    expect(result[0].quantity).toBe("1 bunch");
  });
});

// ---------------------------------------------------------------------------
// applyPantryStatus
// ---------------------------------------------------------------------------

describe("applyPantryStatus", () => {
  it("marks matching items as on_hand when pantryItems is non-empty", () => {
    const result = applyPantryStatus(
      [{ name: "Olive oil", quantity: "", aisle: "Oils & Condiments", status: "needed" }],
      ["olive oil"],
    );
    expect(result[0].status).toBe("on_hand");
  });

  it("marks non-matching items as needed when pantryItems is non-empty", () => {
    const result = applyPantryStatus(
      [{ name: "Rice", quantity: "2 lbs", aisle: "Grains", status: "needed" }],
      ["olive oil"],
    );
    expect(result[0].status).toBe("needed");
  });

  it("defaults all items to needed (unless already on_hand) when pantryItems is empty", () => {
    const result = applyPantryStatus(
      [
        { name: "Rice", quantity: "2 lbs", aisle: "Grains", status: "needed" },
        { name: "Flour", quantity: "1 lb", aisle: "Grains", status: "on_hand" },
      ],
      [],
    );
    expect(result[0].status).toBe("needed");
    expect(result[1].status).toBe("on_hand");
  });
});

// ---------------------------------------------------------------------------
// extractPantryItemsFromPrompt
// ---------------------------------------------------------------------------

describe("extractPantryItemsFromPrompt", () => {
  it("extracts items following a pantry cue", () => {
    const result = extractPantryItemsFromPrompt("I have quinoa and chickpeas on hand.");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns an empty array for a blank prompt", () => {
    expect(extractPantryItemsFromPrompt("   ")).toEqual([]);
  });

  it("does not extract items from a sentence with no pantry cue", () => {
    const result = extractPantryItemsFromPrompt("Please make a toddler-friendly dinner this week.");
    expect(result).toEqual([]);
  });
});
