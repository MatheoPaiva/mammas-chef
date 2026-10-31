/**
 * Unit tests for formatGroceryLine — the single source of truth for
 * grocery-line string formatting (phase 04-shopping-list-quality).
 */
import { describe, it, expect } from "vitest";
import { formatGroceryLine, getGroceryHead, getGroceryParts } from "./groceryDisplay";
import type { GroceryItem } from "@/types/mealPlan";

describe("formatGroceryLine", () => {
  it("formats a normal item with bare quantity and name", () => {
    const item: GroceryItem = {
      name: "Zucchini",
      quantity: "1",
      aisle: "Produce",
      status: "needed",
    };
    expect(formatGroceryLine(item)).toBe("1 Zucchini");
  });

  it("formats a quantity-with-unit and name", () => {
    const item: GroceryItem = {
      name: "Large shrimp",
      quantity: "0.4 lb",
      aisle: "Meat & Seafood",
      status: "needed",
    };
    expect(formatGroceryLine(item)).toBe("0.4 lb Large shrimp");
  });

  it("returns just the name when quantity is empty and not a pantry item", () => {
    const item: GroceryItem = {
      name: "Zucchini",
      quantity: "",
      aisle: "Produce",
      status: "needed",
    };
    expect(formatGroceryLine(item)).toBe("Zucchini");
  });

  it("appends '(check pantry)' for pantry-aisle items with empty quantity", () => {
    const item: GroceryItem = {
      name: "Black pepper",
      quantity: "",
      aisle: "Spices & Seasonings",
      status: "needed",
      pantry: true,
    };
    expect(formatGroceryLine(item)).toBe("Black pepper (check pantry)");
  });

  it("appends '(check pantry)' for non-pantry-aisle items flagged below threshold", () => {
    const item: GroceryItem = {
      name: "Liquid stevia",
      quantity: "",
      aisle: "Oils & Condiments",
      status: "needed",
      pantry: true,
    };
    expect(formatGroceryLine(item)).toBe("Liquid stevia (check pantry)");
  });

  it("does not append pantry suffix when pantry is explicitly false", () => {
    const item: GroceryItem = {
      name: "Bell pepper",
      quantity: "2",
      aisle: "Produce",
      status: "needed",
      pantry: false,
    };
    expect(formatGroceryLine(item)).toBe("2 Bell pepper");
  });

  it("never produces double spaces or leading/trailing whitespace", () => {
    const cases: GroceryItem[] = [
      { name: "Zucchini", quantity: "1", aisle: "Produce", status: "needed" },
      { name: "Large shrimp", quantity: "0.4 lb", aisle: "Meat & Seafood", status: "needed" },
      { name: "Zucchini", quantity: "", aisle: "Produce", status: "needed" },
      { name: "Black pepper", quantity: "", aisle: "Spices & Seasonings", status: "needed", pantry: true },
      { name: "Liquid stevia", quantity: "", aisle: "Oils & Condiments", status: "needed", pantry: true },
      { name: "Bell pepper", quantity: "2", aisle: "Produce", status: "needed", pantry: false },
    ];
    for (const c of cases) {
      const result = formatGroceryLine(c);
      expect(result.includes("  ")).toBe(false);
      expect(result).toBe(result.trim());
    }
  });
});

describe("getGroceryHead", () => {
  it("joins quantity and name with a single space", () => {
    expect(getGroceryHead({ name: "Zucchini", quantity: "1", aisle: "Produce", status: "needed" })).toBe("1 Zucchini");
  });

  it("returns just the name when quantity is empty", () => {
    expect(getGroceryHead({ name: "Zucchini", quantity: "", aisle: "Produce", status: "needed" })).toBe("Zucchini");
  });

  it("omits the pantry suffix even when pantry is true (suffix is formatGroceryLine's job)", () => {
    expect(getGroceryHead({ name: "Black pepper", quantity: "", aisle: "Spices & Seasonings", status: "needed", pantry: true })).toBe("Black pepper");
  });
});

describe("getGroceryParts", () => {
  it("returns quantity, name, and showPantryBadge=true when pantry is true", () => {
    const parts = getGroceryParts({ name: "Liquid stevia", quantity: "", aisle: "Oils & Condiments", status: "needed", pantry: true });
    expect(parts).toEqual({ quantity: "", name: "Liquid stevia", showPantryBadge: true });
  });

  it("returns showPantryBadge=false when pantry is missing", () => {
    const parts = getGroceryParts({ name: "Zucchini", quantity: "2", aisle: "Produce", status: "needed" });
    expect(parts).toEqual({ quantity: "2", name: "Zucchini", showPantryBadge: false });
  });

  it("returns showPantryBadge=false when pantry is explicitly false", () => {
    const parts = getGroceryParts({ name: "Bell pepper", quantity: "2", aisle: "Produce", status: "needed", pantry: false });
    expect(parts.showPantryBadge).toBe(false);
  });
});
