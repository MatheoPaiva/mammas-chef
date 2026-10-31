export type ScalableIngredient = {
  name: string;
  quantity: number | string;
  unit: string;
  prep?: string;
};

export type ScalableMeal = {
  servings?: number;
  ingredients?: ScalableIngredient[];
};

const UNICODE_FRACTIONS: Record<string, number> = {
  "¼": 0.25,
  "½": 0.5,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

function normalizeServings(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function parseQuantity(value: number | string): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  for (const [fraction, amount] of Object.entries(UNICODE_FRACTIONS)) {
    if (trimmed.includes(fraction)) {
      const whole = Number.parseFloat(trimmed.replace(fraction, "").trim());
      return (Number.isFinite(whole) ? whole : 0) + amount;
    }
  }

  if (trimmed.includes("/")) {
    const total = trimmed.split(/\s+/).reduce((sum, part) => {
      if (!part.includes("/")) return sum + (Number.parseFloat(part) || 0);
      const [numerator, denominator] = part.split("/").map(Number);
      return denominator ? sum + numerator / denominator : sum;
    }, 0);
    return total > 0 ? total : null;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundQuantity(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function scaleMealToServings<T extends ScalableMeal>(meal: T, targetServings: number): T {
  const sourceServings = normalizeServings(meal.servings);
  const normalizedTarget = normalizeServings(targetServings);
  if (!sourceServings || !normalizedTarget) return meal;

  const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];

  if (sourceServings === normalizedTarget) {
    return { ...meal, servings: normalizedTarget } as T;
  }

  const ratio = normalizedTarget / sourceServings;
  return {
    ...meal,
    servings: normalizedTarget,
    ingredients: ingredients.map((ingredient) => {
      const quantity = parseQuantity(ingredient.quantity);
      if (quantity === null || quantity <= 0) return ingredient;
      return {
        ...ingredient,
        quantity: roundQuantity(quantity * ratio),
      };
    }),
  } as T;
}
