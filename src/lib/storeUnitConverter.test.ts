import { describe, it, expect } from "vitest";
import { convertToStoreUnit } from "./storeUnitConverter";

describe("convertToStoreUnit", () => {
  // --- Garlic ---
  it("converts 14 cloves garlic → 2 heads", () => {
    const result = convertToStoreUnit({ quantity: 14, unit: "clove", name: "garlic, minced" });
    expect(result.unit).toBe("head");
    expect(result.quantity).toBe(2); // ceil(14/10) = 2
  });

  it("converts 3 cloves garlic → 1 head (minimum 1)", () => {
    const result = convertToStoreUnit({ quantity: 3, unit: "clove", name: "garlic" });
    expect(result.unit).toBe("head");
    expect(result.quantity).toBe(1);
  });

  // --- Eggs ---
  it("converts 16 eggs → 2 dozen", () => {
    const result = convertToStoreUnit({ quantity: 16, unit: "", name: "eggs" });
    expect(result.unit).toBe("dozen");
    expect(result.quantity).toBe(2); // ceil(16/12) = 2
  });

  it("converts 6 eggs → 1 dozen", () => {
    const result = convertToStoreUnit({ quantity: 6, unit: "", name: "eggs" });
    expect(result.unit).toBe("dozen");
    expect(result.quantity).toBe(1);
  });

  it('converts "large" unit eggs → dozen', () => {
    const result = convertToStoreUnit({ quantity: 8, unit: "large", name: "eggs" });
    expect(result.unit).toBe("dozen");
    expect(result.quantity).toBe(1);
  });

  // --- Rice ---
  it("converts 6 cups rice → 3 lbs", () => {
    const result = convertToStoreUnit({ quantity: 6, unit: "cup", name: "rice" });
    expect(result.unit).toBe("lb");
    expect(result.quantity).toBe(3); // ceil(6 * 0.5) = 3
  });

  // --- Broth ---
  it("converts 8 cups chicken broth → 2 cartons", () => {
    const result = convertToStoreUnit({ quantity: 8, unit: "cup", name: "chicken broth" });
    expect(result.unit).toBe("carton (32 oz)");
    expect(result.quantity).toBe(2); // ceil(8/4) = 2
  });

  it("converts 3 cups broth → 1 carton", () => {
    const result = convertToStoreUnit({ quantity: 3, unit: "cup", name: "vegetable broth" });
    expect(result.unit).toBe("carton (32 oz)");
    expect(result.quantity).toBe(1);
  });

  // --- Canned tomatoes ---
  it("converts 3.5 cups diced tomatoes → 2 cans", () => {
    const result = convertToStoreUnit({ quantity: 3.5, unit: "cup", name: "diced tomatoes" });
    expect(result.unit).toBe("can (14 oz)");
    expect(result.quantity).toBe(2); // ceil(3.5/1.75) = 2
  });

  // --- Coconut milk ---
  it("converts 3.5 cups coconut milk → 2 cans", () => {
    const result = convertToStoreUnit({ quantity: 3.5, unit: "cup", name: "coconut milk" });
    expect(result.unit).toBe("can (13.5 oz)");
    expect(result.quantity).toBe(2);
  });

  // --- Beans ---
  it("converts 3 cups chickpeas → 2 cans", () => {
    const result = convertToStoreUnit({ quantity: 3, unit: "cup", name: "chickpeas" });
    expect(result.unit).toBe("can (15 oz)");
    expect(result.quantity).toBe(2);
  });

  // --- Yogurt ---
  it("converts 5 cups greek yogurt → 2 containers", () => {
    const result = convertToStoreUnit({ quantity: 5, unit: "cup", name: "greek yogurt" });
    expect(result.unit).toBe("container (32 oz)");
    expect(result.quantity).toBe(2);
  });

  // --- Tomato paste ---
  it("converts 6 tbsp tomato paste → 1 can", () => {
    const result = convertToStoreUnit({ quantity: 6, unit: "tbsp", name: "tomato paste" });
    expect(result.unit).toBe("can (6 oz)");
    expect(result.quantity).toBe(1);
  });

  // --- Cream cheese ---
  it("converts 12 oz cream cheese → 2 blocks", () => {
    const result = convertToStoreUnit({ quantity: 12, unit: "oz", name: "cream cheese" });
    expect(result.unit).toBe("block (8 oz)");
    expect(result.quantity).toBe(2);
  });

  // --- Flour ---
  it("converts 7 cups flour → 2 lbs", () => {
    const result = convertToStoreUnit({ quantity: 7, unit: "cup", name: "all-purpose flour" });
    expect(result.unit).toBe("lb");
    expect(result.quantity).toBe(2); // ceil(7/3.5) = 2
  });

  // --- No conversion ---
  it("passes through items with no matching rule", () => {
    const item = { quantity: 2, unit: "lb", name: "chicken breast" };
    const result = convertToStoreUnit(item);
    expect(result).toEqual(item);
  });

  it("passes through items where unit doesn't match rule", () => {
    // Rice in lbs already — no conversion needed
    const item = { quantity: 3, unit: "lb", name: "rice" };
    const result = convertToStoreUnit(item);
    expect(result).toEqual(item);
  });

  it("passes through unknown ingredients", () => {
    const item = { quantity: 1, unit: "bunch", name: "cilantro" };
    const result = convertToStoreUnit(item);
    expect(result).toEqual(item);
  });

  // --- False positive guards ---

  it("does NOT convert 'white wine (or chicken broth)' via broth rule", () => {
    const item = { quantity: 0.5, unit: "cup", name: "white wine (or chicken broth)" };
    const result = convertToStoreUnit(item);
    expect(result.unit).toBe("cup"); // unchanged
  });

  it("does NOT convert 'Veggie & Feta Egg Muffins (from Sunday prep)' via egg rule", () => {
    const item = { quantity: 6, unit: "", name: "Veggie & Feta Egg Muffins (from Sunday prep)" };
    const result = convertToStoreUnit(item);
    expect(result.unit).toBe(""); // unchanged, not "dozen"
  });

  it("does NOT convert 'Hard-boiled eggs (from Sunday prep)' via egg rule", () => {
    const item = { quantity: 3, unit: "", name: "Hard-boiled eggs (from Sunday prep)" };
    const result = convertToStoreUnit(item);
    expect(result.unit).toBe(""); // unchanged
  });

  it("does NOT convert 'Energy bites' via any rule", () => {
    const item = { quantity: 6, unit: "", name: "Energy bites (from Sunday prep)" };
    const result = convertToStoreUnit(item);
    expect(result.unit).toBe("");
  });

  // --- RC4: rice rule false positive guards ---
  it("does NOT convert 'rice vinegar' via rice rule", () => {
    const item = { quantity: 2, unit: "cup", name: "rice vinegar" };
    const result = convertToStoreUnit(item);
    expect(result.unit).toBe("cup");
    expect(result.quantity).toBe(2);
  });

  it("does NOT convert 'rice wine' via rice rule", () => {
    const item = { quantity: 1, unit: "cup", name: "rice wine" };
    const result = convertToStoreUnit(item);
    expect(result.unit).toBe("cup");
  });

  it("does NOT convert 'rice paper' via rice rule", () => {
    const item = { quantity: 1, unit: "cup", name: "rice paper wrappers" };
    const result = convertToStoreUnit(item);
    expect(result.unit).toBe("cup");
  });

  it("still converts plain 'rice' via rice rule", () => {
    const item = { quantity: 4, unit: "cup", name: "brown rice" };
    const result = convertToStoreUnit(item);
    expect(result.unit).toBe("lb");
    expect(result.quantity).toBe(2); // ceil(4 * 0.5)
  });

  // --- Milk: cups → half gallons ---
  it("converts 3.4 cups milk → 1 half gallon", () => {
    const result = convertToStoreUnit({ quantity: 3.4, unit: "cup", name: "whole milk" });
    expect(result.unit).toBe("half gallon");
    expect(result.quantity).toBe(1); // ceil(3.4/8) = 1
  });

  it("converts 8 cups milk → 1 half gallon", () => {
    const result = convertToStoreUnit({ quantity: 8, unit: "cup", name: "milk" });
    expect(result.unit).toBe("half gallon");
    expect(result.quantity).toBe(1);
  });

  // --- Fresh herbs → bunches ---
  it("converts 0.5 cup cilantro → 1 bunch", () => {
    const result = convertToStoreUnit({ quantity: 0.5, unit: "cup", name: "cilantro" });
    expect(result.unit).toBe("bunch");
    expect(result.quantity).toBe(1);
  });

  it("converts 3 tbsp parsley → 1 bunch", () => {
    const result = convertToStoreUnit({ quantity: 3, unit: "tbsp", name: "fresh parsley" });
    expect(result.unit).toBe("bunch");
    expect(result.quantity).toBe(1);
  });

  it("converts 2 cups basil → 2 bunches", () => {
    const result = convertToStoreUnit({ quantity: 2, unit: "cup", name: "basil" });
    expect(result.unit).toBe("bunch");
    expect(result.quantity).toBe(2);
  });

  // --- Unitless garlic → heads ---
  it("converts 12 garlic (no unit) → 2 heads", () => {
    const result = convertToStoreUnit({ quantity: 12, unit: "", name: "garlic" });
    expect(result.unit).toBe("head");
    expect(result.quantity).toBe(2); // ceil(12/10) = 2
  });

  it("does NOT convert 'garlic powder' via unitless garlic rule", () => {
    const result = convertToStoreUnit({ quantity: 2, unit: "", name: "garlic powder" });
    expect(result.unit).toBe("");
  });

  // --- Butter → sticks ---
  it("converts 4 tbsp butter → 1 stick", () => {
    const result = convertToStoreUnit({ quantity: 4, unit: "tbsp", name: "butter" });
    expect(result.unit).toBe("stick");
    expect(result.quantity).toBe(1);
  });

  it("converts 1 cup butter → 2 sticks", () => {
    const result = convertToStoreUnit({ quantity: 1, unit: "cup", name: "unsalted butter" });
    expect(result.unit).toBe("stick");
    expect(result.quantity).toBe(2);
  });

  it("does NOT convert 'almond butter' via butter rule", () => {
    const result = convertToStoreUnit({ quantity: 2, unit: "tbsp", name: "almond butter" });
    expect(result.unit).toBe("tbsp");
  });

  // --- Heavy cream → pints ---
  it("converts 1.5 cups heavy cream → 1 pint", () => {
    const result = convertToStoreUnit({ quantity: 1.5, unit: "cup", name: "heavy cream" });
    expect(result.unit).toBe("pint");
    expect(result.quantity).toBe(1); // ceil(1.5/2) = 1
  });

  // --- Produce volume → count ---
  it("converts 2 tbsp ginger → 1 piece", () => {
    const result = convertToStoreUnit({ quantity: 2, unit: "tbsp", name: "fresh ginger" });
    expect(result.unit).toBe("piece");
    expect(result.quantity).toBe(1); // ceil(2 * 0.5) = 1
  });

  it("converts 3 cups spinach → 1 bag", () => {
    const result = convertToStoreUnit({ quantity: 3, unit: "cup", name: "baby spinach" });
    expect(result.unit).toBe("bag (5 oz)");
    expect(result.quantity).toBe(1);
  });

  it("does NOT convert 'frozen spinach' via leafy green rule", () => {
    const result = convertToStoreUnit({ quantity: 2, unit: "cup", name: "frozen spinach" });
    expect(result.unit).toBe("cup");
  });

  it("converts 4 cups broccoli → 1 head", () => {
    const result = convertToStoreUnit({ quantity: 4, unit: "cup", name: "broccoli florets" });
    expect(result.unit).toBe("head");
    expect(result.quantity).toBe(1);
  });

  // --- Lemon juice → count ---
  it("converts 5 tbsp lemon juice → 2 lemons", () => {
    const result = convertToStoreUnit({ quantity: 5, unit: "tbsp", name: "lemon juice" });
    expect(result.unit).toBe("");
    expect(result.quantity).toBe(2); // ceil(5/3) = 2
  });

  it("does NOT convert 'lemon zest' via juice rule", () => {
    const result = convertToStoreUnit({ quantity: 1, unit: "tbsp", name: "lemon zest" });
    expect(result.unit).toBe("tbsp");
  });

  // --- Cheese → bags/containers ---
  it("converts 2 cups shredded mozzarella → 1 bag", () => {
    const result = convertToStoreUnit({ quantity: 2, unit: "cup", name: "shredded mozzarella" });
    expect(result.unit).toBe("bag (8 oz)");
    expect(result.quantity).toBe(1);
  });

  it("converts 1 cup crumbled feta → 1 container", () => {
    const result = convertToStoreUnit({ quantity: 1, unit: "cup", name: "crumbled feta" });
    expect(result.unit).toBe("container (6 oz)");
    expect(result.quantity).toBe(1);
  });

  // --- Phase 4 Plan 02: D-01/D-02 default count-family ceil ---
  // Discrete unitless items must always round up — you cannot buy 0.8 of a
  // bell pepper. The existing rule-matching loop already ceils when a rule
  // matches; the new default ceils unitless items that did not match any rule.
  describe("D-01/D-02 default count-family ceil", () => {
    it("ceils 0.8 Bell pepper → 1 (no matching rule, unitless)", () => {
      const result = convertToStoreUnit({ quantity: 0.8, unit: "", name: "Bell pepper" });
      expect(result.unit).toBe("");
      expect(result.quantity).toBe(1);
      expect(result.name).toBe("Bell pepper");
    });

    it("ceils 0.2 Lime → 1 via existing lime rule (factor 1)", () => {
      const result = convertToStoreUnit({ quantity: 0.2, unit: "", name: "Lime" });
      expect(result.unit).toBe("");
      expect(result.quantity).toBe(1);
    });

    it("ceils 0.3 Whole wheat pita bread → 1 (no matching rule, unitless)", () => {
      const result = convertToStoreUnit({ quantity: 0.3, unit: "", name: "Whole wheat pita bread" });
      expect(result.unit).toBe("");
      expect(result.quantity).toBe(1);
    });

    it("ceils 1.2 Zucchini → 2 (no matching rule, unitless > 1)", () => {
      const result = convertToStoreUnit({ quantity: 1.2, unit: "", name: "Zucchini" });
      expect(result.unit).toBe("");
      expect(result.quantity).toBe(2);
    });

    it("does NOT ceil weight units — only count family ceils (0.4 lb shrimp stays 0.4 lb)", () => {
      const result = convertToStoreUnit({ quantity: 0.4, unit: "lb", name: "Large shrimp" });
      expect(result.unit).toBe("lb");
      expect(result.quantity).toBe(0.4);
    });

    it("leaves whole-count items unchanged (3 Zucchini stays 3)", () => {
      const result = convertToStoreUnit({ quantity: 3, unit: "", name: "Zucchini" });
      expect(result.unit).toBe("");
      expect(result.quantity).toBe(3);
    });
  });
});
