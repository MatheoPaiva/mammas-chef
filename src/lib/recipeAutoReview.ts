import type {
  RecipeLibraryIngredient,
  RecipeLibraryStep,
  RecipeMachineReviewDecision,
  RecipeMachineReviewIssue,
  RecipeMachineReviewSnapshot,
} from "@/types/recipeLibrary";

export interface RecipeAutoReviewInput {
  id?: string;
  title: string;
  cuisine?: string | null;
  region?: string | null;
  mealTypes: string[];
  dietTags: string[];
  flavorTags: string[];
  equipment: string[];
  activeTimeMinutes?: number | null;
  totalTimeMinutes?: number | null;
  servings?: number | null;
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fats?: number | null;
  ingredients: RecipeLibraryIngredient[];
  steps: RecipeLibraryStep[];
  storageNotes?: string | null;
  reheatNotes?: string | null;
  prepAheadNotes?: string | null;
  toddlerTip?: string | null;
  glucoseTip?: string | null;
  sourceUrl?: string | null;
  sourceAttribution?: string | null;
}

export interface RecipeAutoReviewDuplicateHint {
  duplicateOfRecipeId: string | null;
  duplicateOfTitle: string | null;
  relatedTitles: string[];
  issue?: RecipeMachineReviewIssue;
  tags: string[];
}

export interface RecipeAutoReviewDeterministicResult extends RecipeMachineReviewSnapshot {
  issues: RecipeMachineReviewIssue[];
}

const STOP_WORDS = new Set([
  "and", "with", "the", "a", "an", "of", "for", "to", "or", "in", "on", "into", "from", "up", "over",
  "fresh", "optional", "taste", "minutes", "minute", "cup", "cups",
]);

const GENERIC_INGREDIENTS = new Set([
  "oil", "olive", "salt", "pepper", "water", "garlic", "lemon", "onion", "parsley",
]);

function normalizeText(value: string | undefined | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string | undefined | null): Set<string> {
  return new Set(
    normalizeText(value)
      .split(" ")
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function ingredientTokens(recipe: RecipeAutoReviewInput): Set<string> {
  return new Set(
    recipe.ingredients.flatMap((ingredient) => (
      [...tokenize(ingredient.name)].filter((token) => !GENERIC_INGREDIENTS.has(token))
    )),
  );
}

function recipeSemanticText(recipe: RecipeAutoReviewInput): string {
  return [
    recipe.title,
    recipe.cuisine,
    recipe.region,
    ...recipe.mealTypes,
    ...recipe.dietTags,
    ...recipe.flavorTags,
    recipe.prepAheadNotes,
    recipe.storageNotes,
    recipe.reheatNotes,
    recipe.toddlerTip,
    recipe.glucoseTip,
    ...recipe.ingredients.map((ingredient) => ingredient.name),
  ].filter(Boolean).join(" ");
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function buildIssue(code: string, severity: RecipeMachineReviewIssue["severity"], message: string): RecipeMachineReviewIssue {
  return { code, severity, message };
}

function scorePenaltyForIssue(severity: RecipeMachineReviewIssue["severity"]): number {
  if (severity === "critical") return 22;
  if (severity === "warning") return 8;
  return 3;
}

function computeDecision(score: number, confidence: number, issues: RecipeMachineReviewIssue[]): RecipeMachineReviewDecision {
  if (issues.some((issue) => issue.severity === "critical")) return "reject";
  if (score >= 85 && confidence >= 0.8) return "approve";
  if (score < 55 || confidence < 0.45) return "reject";
  return "review";
}

function summarizeIssues(issues: RecipeMachineReviewIssue[], title: string): string {
  if (issues.length === 0) return `${title} looks internally consistent and planning-ready for manual spot-check review.`;
  const criticalCount = issues.filter((issue) => issue.severity === "critical").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  if (criticalCount > 0) return `${title} has ${criticalCount} critical issue${criticalCount === 1 ? "" : "s"} and should not be promoted without fixes.`;
  if (warningCount > 0) return `${title} has ${warningCount} warning${warningCount === 1 ? "" : "s"} and should stay in the human review queue.`;
  return `${title} has minor metadata gaps but is otherwise usable.`;
}

function buildSuggestedFixes(recipe: RecipeAutoReviewInput, issues: RecipeMachineReviewIssue[]): string[] {
  const fixes: string[] = [];
  if (issues.some((issue) => issue.code === "missing-source")) fixes.push("Add source attribution or mark the recipe as fully original internal content.");
  if (issues.some((issue) => issue.code === "missing-nutrition")) fixes.push("Add nutrition estimates before promoting the recipe.");
  if (issues.some((issue) => issue.code === "missing-toddler-tip")) fixes.push("Add a toddler adaptation note.");
  if (issues.some((issue) => issue.code === "missing-glucose-tip")) fixes.push("Add a glucose-balancing note.");
  if (issues.some((issue) => issue.code === "missing-planning-notes")) fixes.push("Add at least one prep, storage, or reheat note.");
  if (issues.some((issue) => issue.code === "ingredient-method-gap")) fixes.push("Update the method so the named core ingredients clearly appear in the cooking steps.");
  if (issues.some((issue) => issue.code === "duplicate-title" || issue.code === "duplicate-profile")) fixes.push("Merge with the earlier duplicate or revise the concept to be meaningfully distinct.");
  if (issues.some((issue) => issue.code === "step-count-light") && recipe.ingredients.length >= 8) fixes.push("Break the method into more detailed steps so the recipe is easier to execute.");
  return unique(fixes);
}

export function analyzeRecipeDuplicates(recipes: RecipeAutoReviewInput[]): Map<string, RecipeAutoReviewDuplicateHint> {
  const byId = new Map<string, RecipeAutoReviewDuplicateHint>();
  for (const recipe of recipes) {
    if (!recipe.id) continue;
    byId.set(recipe.id, {
      duplicateOfRecipeId: null,
      duplicateOfTitle: null,
      relatedTitles: [],
      tags: [],
    });
  }

  for (let index = 0; index < recipes.length; index += 1) {
    const recipe = recipes[index];
    if (!recipe.id) continue;

    for (let compareIndex = 0; compareIndex < index; compareIndex += 1) {
      const compared = recipes[compareIndex];
      if (!compared.id) continue;

      const titleScore = jaccard(tokenize(recipe.title), tokenize(compared.title));
      const semanticScore = jaccard(tokenize(recipeSemanticText(recipe)), tokenize(recipeSemanticText(compared)));
      const ingredientScore = jaccard(ingredientTokens(recipe), ingredientTokens(compared));

      const current = byId.get(recipe.id);
      if (!current) continue;

      if (titleScore >= 0.92) {
        current.duplicateOfRecipeId = compared.id;
        current.duplicateOfTitle = compared.title;
        current.relatedTitles = unique([...current.relatedTitles, compared.title]);
        current.tags = unique([...current.tags, "duplicate-risk", "title-duplicate"]);
        current.issue = buildIssue("duplicate-title", "critical", `Very close title overlap with "${compared.title}".`);
        break;
      }

      if (semanticScore >= 0.8 || ingredientScore >= 0.78) {
        current.relatedTitles = unique([...current.relatedTitles, compared.title]);
        current.tags = unique([...current.tags, "duplicate-risk"]);
        if (!current.issue) {
          current.issue = buildIssue("duplicate-profile", "warning", `Similar ingredient or concept profile to "${compared.title}".`);
        }
      }
    }
  }

  return byId;
}

export function assessRecipeDeterministically(
  recipe: RecipeAutoReviewInput,
  duplicateHint?: RecipeAutoReviewDuplicateHint,
): RecipeAutoReviewDeterministicResult {
  const issues: RecipeMachineReviewIssue[] = [];
  const tags: string[] = [];

  if (!recipe.sourceUrl && !recipe.sourceAttribution) {
    issues.push(buildIssue("missing-source", "warning", "Source attribution is missing."));
    tags.push("metadata-gap");
  }

  if (recipe.ingredients.length === 0) {
    issues.push(buildIssue("missing-ingredients", "critical", "Ingredient list is empty."));
    tags.push("critical");
  }

  if (recipe.steps.length === 0) {
    issues.push(buildIssue("missing-steps", "critical", "Method is empty."));
    tags.push("critical");
  }

  if (!recipe.calories && !recipe.protein && !recipe.carbs && !recipe.fats) {
    issues.push(buildIssue("missing-nutrition", "warning", "Nutrition is missing."));
    tags.push("metadata-gap");
  }

  if (!recipe.toddlerTip?.trim()) {
    issues.push(buildIssue("missing-toddler-tip", "warning", "Toddler adaptation note is missing."));
    tags.push("planning-gap");
  }

  if (!recipe.glucoseTip?.trim()) {
    issues.push(buildIssue("missing-glucose-tip", "warning", "Glucose guidance is missing."));
    tags.push("planning-gap");
  }

  if (![recipe.prepAheadNotes, recipe.storageNotes, recipe.reheatNotes].some((value) => value?.trim())) {
    issues.push(buildIssue("missing-planning-notes", "warning", "Prep, storage, and reheat notes are all missing."));
    tags.push("planning-gap");
  }

  if (!recipe.totalTimeMinutes || recipe.totalTimeMinutes <= 0) {
    issues.push(buildIssue("missing-total-time", "warning", "Total time is missing or invalid."));
    tags.push("metadata-gap");
  }

  if (recipe.activeTimeMinutes && recipe.totalTimeMinutes && recipe.activeTimeMinutes > recipe.totalTimeMinutes) {
    issues.push(buildIssue("invalid-time-range", "critical", "Active time exceeds total time."));
    tags.push("critical");
  }

  if (!recipe.servings || recipe.servings <= 0) {
    issues.push(buildIssue("invalid-servings", "critical", "Servings are missing or invalid."));
    tags.push("critical");
  }

  const prominentIngredientTokens = [...ingredientTokens(recipe)].slice(0, 6);
  const methodText = normalizeText(recipe.steps.map((step) => step.text).join(" "));
  const missingMethodTokens = prominentIngredientTokens.filter((token) => !methodText.includes(token));
  if (prominentIngredientTokens.length >= 3 && missingMethodTokens.length >= Math.ceil(prominentIngredientTokens.length / 2)) {
    issues.push(buildIssue("ingredient-method-gap", "warning", "Core ingredients are not clearly reflected in the method."));
    tags.push("coherence-risk");
  }

  if (recipe.ingredients.length >= 8 && recipe.steps.length <= 2) {
    issues.push(buildIssue("step-count-light", "warning", "Method is too compressed for the ingredient count."));
    tags.push("coherence-risk");
  }

  const totalTimers = recipe.steps.reduce((sum, step) => sum + (step.timerMinutes ?? 0), 0);
  if (recipe.totalTimeMinutes && totalTimers > recipe.totalTimeMinutes * 1.8) {
    issues.push(buildIssue("timing-overflow", "warning", "Step timers materially exceed the claimed total time."));
    tags.push("timing-risk");
  }

  if (duplicateHint?.issue) {
    issues.push(duplicateHint.issue);
    tags.push(...duplicateHint.tags);
  }

  const normalizedTags = unique(tags);
  const score = Math.max(0, Math.round(100 - issues.reduce((sum, issue) => sum + scorePenaltyForIssue(issue.severity), 0)));
  const confidence = Number(Math.min(0.98, Math.max(0.35, 0.55 + (normalizedTags.length === 0 ? 0.25 : 0) + (issues.length === 0 ? 0.1 : 0) - issues.filter((issue) => issue.severity === "critical").length * 0.12 - issues.filter((issue) => issue.severity === "warning").length * 0.05)).toFixed(3));
  const decision = computeDecision(score, confidence, issues);

  return {
    decision,
    score,
    confidence,
    summary: summarizeIssues(issues, recipe.title),
    issues,
    suggestedFixes: buildSuggestedFixes(recipe, issues),
    tags: normalizedTags,
    duplicateOfRecipeId: duplicateHint?.duplicateOfRecipeId ?? null,
    duplicateOfTitle: duplicateHint?.duplicateOfTitle ?? null,
    model: "deterministic-rules",
    version: "recipe-auto-review-v1",
    reviewedAt: null,
  };
}

export interface RecipeAutoReviewMergeInput {
  deterministic: RecipeAutoReviewDeterministicResult;
  llm?: Partial<RecipeMachineReviewSnapshot> | null;
}

export function mergeRecipeAutoReview({ deterministic, llm }: RecipeAutoReviewMergeInput): RecipeMachineReviewSnapshot {
  if (!llm) return deterministic;

  const llmScore = typeof llm.score === "number" ? llm.score : deterministic.score;
  const llmConfidence = typeof llm.confidence === "number" ? llm.confidence : deterministic.confidence;
  const issues = unique([
    ...deterministic.issues.map((issue) => JSON.stringify(issue)),
    ...(llm.issues ?? []).map((issue) => JSON.stringify(issue)),
  ]).map((item) => JSON.parse(item) as RecipeMachineReviewIssue);
  const tags = unique([...(deterministic.tags ?? []), ...(llm.tags ?? [])]);
  const suggestedFixes = unique([...(deterministic.suggestedFixes ?? []), ...(llm.suggestedFixes ?? [])]);
  const score = Math.round((deterministic.score * 0.45) + (llmScore * 0.55));
  const confidence = Number(((deterministic.confidence * 0.4) + (llmConfidence * 0.6)).toFixed(3));
  const decision = llm.decision
    ? computeDecision(score, confidence, [
      ...issues,
      ...(llm.decision === "reject" ? [buildIssue("llm-reject", "warning", "LLM triage preferred rejection.")] : []),
    ])
    : computeDecision(score, confidence, issues);

  return {
    decision: llm.decision === "reject" && deterministic.decision === "approve" ? "review" : decision,
    score,
    confidence,
    summary: llm.summary?.trim() || deterministic.summary,
    issues,
    suggestedFixes,
    tags,
    duplicateOfRecipeId: llm.duplicateOfRecipeId ?? deterministic.duplicateOfRecipeId ?? null,
    duplicateOfTitle: llm.duplicateOfTitle ?? deterministic.duplicateOfTitle ?? null,
    model: llm.model ?? deterministic.model,
    version: llm.version ?? deterministic.version,
    reviewedAt: llm.reviewedAt ?? deterministic.reviewedAt,
  };
}
