import { z } from "zod";
import { recipeLibraryCollectionSchema, type RecipeLibraryInputFromSchema } from "./recipeLibrarySchema";

export type RecipeLabMealType = "breakfast" | "lunch" | "dinner" | "snack";

export type RecipeLabConstraint = {
  day: number;
  slot: number;
  mealType: RecipeLabMealType;
  region: string;
  protein: string;
  time: string;
  format: string;
  familyConstraint: string;
};

export type RecipeLabDedupeIssue = {
  kind: "title" | "semantic" | "ingredient";
  recipeTitle: string;
  comparedWith: string;
  score: number;
};

export type RecipeLabDedupeReport = {
  recipeCount: number;
  issues: RecipeLabDedupeIssue[];
  titleDuplicateCount: number;
  semanticNearDuplicateCount: number;
  ingredientNearDuplicateCount: number;
  score: number;
};

export type RecipeLabCoverageReport = {
  requested: number;
  generated: number;
  mealTypeCoverage: Record<string, { requested: number; generated: number }>;
  regionCoverage: Record<string, { requested: number; generated: number }>;
  proteinCoverage: Record<string, { requested: number; generated: number }>;
  prepTimeCoverage: Record<string, { requested: number; generated: number }>;
  familyTagCoverage: Record<string, { requested: number; generated: number }>;
  missingConstraintMatches: RecipeLabConstraint[];
  score: number;
};

export type RecipeLabQualityReport = {
  coverage: RecipeLabCoverageReport;
  dedupe: RecipeLabDedupeReport;
  pass: boolean;
  warnings: string[];
};

const titleStopWords = new Set(["and", "with", "the", "a", "an", "of", "for", "to", "or", "in", "on"]);

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string | undefined): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 2 && !titleStopWords.has(token)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function canonicalTitle(title: string): string {
  return normalizeText(title).replace(/\b(mediterranean|inspired|style|bowl|plate)\b/g, "").replace(/\s+/g, " ").trim();
}

function recipeSemanticText(recipe: RecipeLibraryInputFromSchema): string {
  return [
    recipe.title,
    recipe.region,
    ...(recipe.mealTypes ?? []),
    ...(recipe.dietTags ?? []),
    ...(recipe.flavorTags ?? []),
    recipe.prepAheadNotes,
    recipe.glucoseTip,
    ...recipe.ingredients.map((ingredient) => ingredient.name),
  ].filter(Boolean).join(" ");
}

function ingredientTokens(recipe: RecipeLibraryInputFromSchema): Set<string> {
  const generic = new Set(["oil", "olive", "salt", "pepper", "water", "lemon", "garlic", "onion", "parsley"]);
  return new Set(recipe.ingredients.flatMap((ingredient) => [...tokenize(ingredient.name)].filter((token) => !generic.has(token))));
}

function containsAny(haystack: string, needles: string[]): boolean {
  const normalized = normalizeText(haystack);
  return needles.some((needle) => normalized.includes(normalizeText(needle)));
}

function proteinKeywords(protein: string): string[] {
  return protein.split(/\s+or\s+|,|\//i).map((item) => item.trim()).filter(Boolean);
}

function timeBucket(time: string): string {
  const minutes = Number(time.match(/(\d+)/)?.[1] ?? 0);
  if (minutes > 0) return `${minutes} minutes or less`;
  if (/sheet[- ]pan/i.test(time)) return "sheet-pan friendly";
  if (/meal[- ]prep/i.test(time)) return "meal-prep friendly";
  return normalizeText(time);
}

function familyTag(familyConstraint: string): string {
  if (/toddler/i.test(familyConstraint)) return "toddler-adaptable";
  if (/glucose|fiber|protein balance/i.test(familyConstraint)) return "glucose-friendly";
  if (/leftover/i.test(familyConstraint)) return "leftovers";
  if (/spicy|heat optional/i.test(familyConstraint)) return "mild-by-default";
  if (/cleanup|one-pan|minimal/i.test(familyConstraint)) return "minimal-cleanup";
  if (/busy parent/i.test(familyConstraint)) return "busy-parent-friendly";
  if (/grocery/i.test(familyConstraint)) return "normal-grocery";
  return normalizeText(familyConstraint);
}

function incrementRequested(map: Record<string, { requested: number; generated: number }>, key: string) {
  map[key] ??= { requested: 0, generated: 0 };
  map[key].requested += 1;
}

function incrementGenerated(map: Record<string, { requested: number; generated: number }>, key: string) {
  map[key] ??= { requested: 0, generated: 0 };
  map[key].generated += 1;
}

export function parseRecipeLabJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && "recipes" in parsed) return (parsed as { recipes: unknown }).recipes;
    return parsed;
  } catch (firstError) {
    const firstArray = trimmed.indexOf("[");
    const lastArray = trimmed.lastIndexOf("]");
    if (firstArray >= 0 && lastArray > firstArray) {
      const parsed = JSON.parse(trimmed.slice(firstArray, lastArray + 1));
      return parsed && typeof parsed === "object" && "recipes" in parsed ? (parsed as { recipes: unknown }).recipes : parsed;
    }
    const firstObject = trimmed.indexOf("{");
    const lastObject = trimmed.lastIndexOf("}");
    if (firstObject >= 0 && lastObject > firstObject) {
      const parsed = JSON.parse(trimmed.slice(firstObject, lastObject + 1));
      return parsed && typeof parsed === "object" && "recipes" in parsed ? (parsed as { recipes: unknown }).recipes : parsed;
    }
    throw firstError;
  }
}

export function validateRecipeLabContent(content: string): RecipeLibraryInputFromSchema[] {
  return recipeLibraryCollectionSchema.parse(parseRecipeLabJson(content));
}

export function summarizeZodError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).slice(0, 20).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

export function scoreRecipeLabDedupe(recipes: RecipeLibraryInputFromSchema[], seedRecipes: RecipeLibraryInputFromSchema[] = []): RecipeLabDedupeReport {
  const issues: RecipeLabDedupeIssue[] = [];
  const allCompared = [...seedRecipes, ...recipes];

  for (let i = 0; i < recipes.length; i += 1) {
    const recipe = recipes[i];
    const comparedEnd = seedRecipes.length + i;
    for (let j = 0; j < comparedEnd; j += 1) {
      const compared = allCompared[j];
      const titleScore = canonicalTitle(recipe.title) === canonicalTitle(compared.title) ? 1 : jaccard(tokenize(recipe.title), tokenize(compared.title));
      const semanticScore = jaccard(tokenize(recipeSemanticText(recipe)), tokenize(recipeSemanticText(compared)));
      const ingredientScore = jaccard(ingredientTokens(recipe), ingredientTokens(compared));
      if (titleScore >= 0.92) issues.push({ kind: "title", recipeTitle: recipe.title, comparedWith: compared.title, score: Number(titleScore.toFixed(3)) });
      else if (semanticScore >= 0.78) issues.push({ kind: "semantic", recipeTitle: recipe.title, comparedWith: compared.title, score: Number(semanticScore.toFixed(3)) });
      else if (ingredientScore >= 0.72) issues.push({ kind: "ingredient", recipeTitle: recipe.title, comparedWith: compared.title, score: Number(ingredientScore.toFixed(3)) });
    }
  }

  const weightedIssueCount = issues.reduce((total, issue) => total + (issue.kind === "title" ? 1 : 0.6), 0);
  return {
    recipeCount: recipes.length,
    issues,
    titleDuplicateCount: issues.filter((issue) => issue.kind === "title").length,
    semanticNearDuplicateCount: issues.filter((issue) => issue.kind === "semantic").length,
    ingredientNearDuplicateCount: issues.filter((issue) => issue.kind === "ingredient").length,
    score: recipes.length === 0 ? 1 : Number(Math.max(0, 1 - weightedIssueCount / recipes.length).toFixed(3)),
  };
}

export function scoreRecipeLabCoverage(constraints: RecipeLabConstraint[], recipes: RecipeLibraryInputFromSchema[]): RecipeLabCoverageReport {
  const mealTypeCoverage: RecipeLabCoverageReport["mealTypeCoverage"] = {};
  const regionCoverage: RecipeLabCoverageReport["regionCoverage"] = {};
  const proteinCoverage: RecipeLabCoverageReport["proteinCoverage"] = {};
  const prepTimeCoverage: RecipeLabCoverageReport["prepTimeCoverage"] = {};
  const familyTagCoverage: RecipeLabCoverageReport["familyTagCoverage"] = {};

  for (const constraint of constraints) {
    incrementRequested(mealTypeCoverage, constraint.mealType);
    incrementRequested(regionCoverage, constraint.region);
    incrementRequested(proteinCoverage, constraint.protein);
    incrementRequested(prepTimeCoverage, timeBucket(constraint.time));
    incrementRequested(familyTagCoverage, familyTag(constraint.familyConstraint));
  }

  const missingConstraintMatches: RecipeLabConstraint[] = [];
  for (let i = 0; i < constraints.length; i += 1) {
    const constraint = constraints[i];
    const recipe = recipes[i];
    if (!recipe) {
      missingConstraintMatches.push(constraint);
      continue;
    }

    if (recipe.mealTypes.includes(constraint.mealType)) incrementGenerated(mealTypeCoverage, constraint.mealType);
    else missingConstraintMatches.push(constraint);

    if (containsAny(`${recipe.region} ${recipe.title} ${recipe.flavorTags.join(" ")}`, [constraint.region.replace(/-inspired/i, "")])) incrementGenerated(regionCoverage, constraint.region);
    if (containsAny(`${recipe.title} ${recipe.ingredients.map((ingredient) => ingredient.name).join(" ")}`, proteinKeywords(constraint.protein))) incrementGenerated(proteinCoverage, constraint.protein);

    const maxMinutes = Number(constraint.time.match(/(\d+)/)?.[1] ?? 0);
    if (maxMinutes > 0 ? (recipe.totalTimeMinutes ?? Infinity) <= maxMinutes : containsAny(`${recipe.prepAheadNotes} ${recipe.equipment.join(" ")} ${recipe.dietTags.join(" ")}`, [constraint.time])) {
      incrementGenerated(prepTimeCoverage, timeBucket(constraint.time));
    }

    const tag = familyTag(constraint.familyConstraint);
    if (containsAny(`${recipe.toddlerTip} ${recipe.glucoseTip} ${recipe.prepAheadNotes} ${recipe.storageNotes} ${recipe.dietTags.join(" ")}`, [tag, constraint.familyConstraint])) {
      incrementGenerated(familyTagCoverage, tag);
    }
  }

  const maps = [mealTypeCoverage, regionCoverage, proteinCoverage, prepTimeCoverage, familyTagCoverage];
  const matched = maps.flatMap((map) => Object.values(map)).reduce((total, item) => total + Math.min(item.generated, item.requested), 0);
  const requested = maps.flatMap((map) => Object.values(map)).reduce((total, item) => total + item.requested, 0);

  return {
    requested: constraints.length,
    generated: recipes.length,
    mealTypeCoverage,
    regionCoverage,
    proteinCoverage,
    prepTimeCoverage,
    familyTagCoverage,
    missingConstraintMatches,
    score: requested === 0 ? 1 : Number((matched / requested).toFixed(3)),
  };
}

export function scoreRecipeLabQuality(constraints: RecipeLabConstraint[], recipes: RecipeLibraryInputFromSchema[], seedRecipes: RecipeLibraryInputFromSchema[] = []): RecipeLabQualityReport {
  const coverage = scoreRecipeLabCoverage(constraints, recipes);
  const dedupe = scoreRecipeLabDedupe(recipes, seedRecipes);
  const warnings = [
    ...(coverage.score < 0.8 ? [`coverage score ${coverage.score} is below 0.8`] : []),
    ...(dedupe.score < 0.9 ? [`dedupe score ${dedupe.score} is below 0.9`] : []),
    ...(recipes.length !== constraints.length ? [`expected ${constraints.length} recipes, got ${recipes.length}`] : []),
  ];
  return { coverage, dedupe, pass: warnings.length === 0, warnings };
}
