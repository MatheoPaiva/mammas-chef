import type { GroceryItem } from "@/types/mealPlan";
import { normalizeIngredientName, ingredientsMatch, categorizeAisle } from "./ingredientParser";

const PANTRY_CUES = [
  "i have",
  "we have",
  "i've got",
  "we've got",
  "on hand",
  "in my pantry",
  "in the pantry",
  "in my fridge",
  "in the fridge",
  "available",
  "left over",
  "leftover",
];

const NON_PANTRY_HINTS = /\b(toddler|kid|child|baby|love|likes|prefer|allerg|craving|want|need|please|plan|recipe|week|meal)\b/i;

// normalizeIngredientName and ingredientsMatch are re-exported from ingredientParser
export { normalizeIngredientName, ingredientsMatch };

function extractPantrySegment(sentence: string): string | null {
  const lower = sentence.toLowerCase();
  const cue = PANTRY_CUES.find((candidate) => lower.includes(candidate));
  if (!cue) return null;

  const idx = lower.indexOf(cue);
  return sentence
    .slice(idx + cue.length)
    .split(/\b(?:but|also|please)\b/i)[0]
    .trim();
}

function collectCandidates(rawSegment: string, collected: Set<string>) {
  if (!rawSegment) return;

  const candidates = rawSegment
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (NON_PANTRY_HINTS.test(candidate)) continue;

    const normalized = normalizeIngredientName(candidate);
    if (normalized) {
      collected.add(normalized);
    }
  }
}

export function extractPantryItemsFromPrompt(prompt: string): string[] {
  if (!prompt.trim()) return [];

  const collected = new Set<string>();
  let sawCue = false;
  const sentences = prompt
    .split(/[\n.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    const segment = extractPantrySegment(sentence);
    if (!segment) continue;
    sawCue = true;
    collectCandidates(segment, collected);
  }

  if (!sawCue && !NON_PANTRY_HINTS.test(prompt)) {
    collectCandidates(prompt, collected);
  }

  return Array.from(collected);
}

export function applyPantryStatus(items: GroceryItem[], pantryItems: string[]): GroceryItem[] {
  if (pantryItems.length === 0) {
    return items.map((item) => ({
      ...item,
      status: item.status === "on_hand" ? "on_hand" : "needed",
    }));
  }

  return items.map((item) => ({
    ...item,
    status: pantryItems.some((pantryItem) => ingredientsMatch(item.name, pantryItem)) ? "on_hand" : "needed",
  }));
}

/**
 * Strip the item name from the quantity string if it appears there.
 * Prevents "1 bunch cilantro" quantity + "cilantro" name → "1 bunch cilantro cilantro".
 */
function stripNameFromQuantity(quantity: string, name: string): string {
  if (!quantity || !name) return quantity;
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return quantity.replace(new RegExp(`(\\s+${escaped})+\\s*$`, "i"), "").trim();
}

export function normalizeGroceryItems(items: Array<Partial<GroceryItem>> | null | undefined): GroceryItem[] {
  if (!items) return [];

  return items
    .filter((item): item is Partial<GroceryItem> & Pick<GroceryItem, "name" | "quantity"> => (
      typeof item?.name === "string" &&
      typeof item.quantity === "string"
    ))
    .map((item) => ({
      name: item.name,
      quantity: stripNameFromQuantity(item.quantity, item.name),
      aisle: (typeof item.aisle === "string" && item.aisle) ? item.aisle : categorizeAisle(item.name),
      status: item.status === "on_hand" ? "on_hand" : "needed",
      // D-20 — this whitelist previously silently dropped both fields on every
      // reload/AI-humanize round-trip. sources is required for shopping-list
      // traceability (D-18, SHOP-04); pantry is a pre-existing gap fixed
      // opportunistically now that this function is touched anyway.
      sources: Array.isArray(item.sources) ? item.sources : undefined,
      pantry: item.pantry === true ? true : undefined,
    }));
}
