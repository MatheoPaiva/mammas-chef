export type RecipeMealType = "breakfast" | "lunch" | "dinner" | "snack";
export type RecipeStatus = "draft" | "reviewed" | "tested" | "archived";
export type RecipeChunkType = "overview" | "ingredients" | "method" | "planning" | "shopping";
export type RecipeMachineReviewDecision = "approve" | "review" | "reject";
export type RecipeMachineReviewSeverity = "info" | "warning" | "critical";

export interface RecipeMachineReviewIssue {
  code: string;
  severity: RecipeMachineReviewSeverity;
  message: string;
}

export interface RecipeMachineReviewSnapshot {
  decision: RecipeMachineReviewDecision;
  score: number;
  confidence: number;
  summary: string;
  issues: RecipeMachineReviewIssue[];
  suggestedFixes: string[];
  tags: string[];
  duplicateOfRecipeId?: string | null;
  duplicateOfTitle?: string | null;
  model?: string | null;
  version?: string | null;
  reviewedAt?: string | null;
}

export interface RecipeSourceInput {
  name: string;
  url?: string | null;
  author?: string | null;
  license: string;
  usageNotes?: string | null;
}

export interface RecipeLibraryIngredient {
  name: string;
  quantity: number;
  unit: string;
  prep?: string;
  category?: string;
  optional?: boolean;
}

export interface RecipeLibraryStep {
  order: number;
  text: string;
  timerMinutes?: number;
}

export interface RecipeNutrition {
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
}

export interface RecipeLibraryInput {
  title: string;
  cuisine?: string;
  region?: string;
  mealTypes: RecipeMealType[];
  dietTags: string[];
  flavorTags: string[];
  equipment: string[];
  activeTimeMinutes?: number;
  totalTimeMinutes?: number;
  servings: number;
  nutrition?: RecipeNutrition;
  ingredients: RecipeLibraryIngredient[];
  steps: RecipeLibraryStep[];
  storageNotes?: string;
  reheatNotes?: string;
  prepAheadNotes?: string;
  toddlerTip?: string;
  glucoseTip?: string;
  status?: RecipeStatus;
  source: RecipeSourceInput;
}

export interface RecipeChunkInput {
  chunkType: RecipeChunkType;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
}

export interface RecipeSearchFilters {
  mealType?: RecipeMealType;
  /** Broad user-facing tags that may match either diet_tags or flavor_tags. */
  tags?: string[];
  dietTags?: string[];
  flavorTags?: string[];
  /** Ingredient names that should appear in the structured recipe ingredients. */
  includeIngredients?: string[];
  /** Ingredient names that should not appear in the structured recipe ingredients. */
  avoidIngredients?: string[];
  maxTotalTimeMinutes?: number;
  cuisine?: string;
  statuses?: RecipeStatus[];
  toddlerFriendly?: boolean;
  glucoseFriendly?: boolean;
}
