/**
 * groceryDisplay.ts — single source of truth for grocery-line string formatting.
 *
 * Phase 04-shopping-list-quality, Plan 01 (foundation): callers (UI renderers,
 * PDF/CSV exporters, copy-to-clipboard) all funnel through formatGroceryLine
 * so spacing, empty-quantity handling, and the "(check pantry)" suffix are
 * applied identically everywhere. Plans 02 (builder) and 03 (consumer
 * migration) wire this in.
 *
 * Behavior contract (see 04-01-PLAN.md):
 *   { quantity: "1",      name: "Zucchini" }                 → "1 Zucchini"
 *   { quantity: "0.4 lb", name: "Large shrimp" }             → "0.4 lb Large shrimp"
 *   { quantity: "",       name: "Zucchini" }                 → "Zucchini"
 *   { quantity: "",       name: "Black pepper", pantry:true} → "Black pepper (check pantry)"
 *
 * Note: item.quantity is assumed already-formatted by shoppingListBuilder Pass 3
 * (which runs formatQuantity from ingredientParser). This helper is purely a
 * join/decorator — it never reformats quantity.
 */
import type { GroceryItem } from "@/types/mealPlan";

export interface GroceryParts {
  quantity: string;
  name: string;
  showPantryBadge: boolean;
}

export function getGroceryParts(item: GroceryItem): GroceryParts {
  return {
    quantity: item.quantity ?? "",
    name: item.name,
    showPantryBadge: item.pantry === true,
  };
}

export function getGroceryHead(item: GroceryItem): string {
  const { quantity, name } = getGroceryParts(item);
  return quantity ? `${quantity} ${name}` : name;
}

export function formatGroceryLine(item: GroceryItem): string {
  const head = getGroceryHead(item);
  return getGroceryParts(item).showPantryBadge ? `${head} (check pantry)` : head;
}
