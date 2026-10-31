import { supabase } from "@/integrations/supabase/client";
import type {
  RecipeLibraryIngredient,
  RecipeLibraryStep,
  RecipeMachineReviewSnapshot,
  RecipeMealType,
  RecipeStatus,
} from "@/types/recipeLibrary";

type ReviewRecipeRow = {
  id: string;
  title: string;
  cuisine: string | null;
  region: string | null;
  meal_types: string[] | null;
  diet_tags: string[] | null;
  flavor_tags: string[] | null;
  equipment: string[] | null;
  active_time_minutes: number | null;
  total_time_minutes: number | null;
  servings: number | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  ingredients: unknown;
  steps: unknown;
  storage_notes: string | null;
  reheat_notes: string | null;
  prep_ahead_notes: string | null;
  toddler_tip: string | null;
  glucose_tip: string | null;
  status: RecipeStatus;
  source_url: string | null;
  source_attribution: string | null;
  machine_reviewed_at: string | null;
  machine_review_model: string | null;
  machine_review_version: string | null;
  machine_review_decision: RecipeMachineReviewSnapshot["decision"] | null;
  machine_review_score: number | null;
  machine_review_confidence: number | null;
  machine_review_summary: string | null;
  machine_review_issues: unknown;
  machine_review_suggested_fixes: unknown;
  machine_review_tags: string[] | null;
  machine_review_duplicate_of_recipe_id: string | null;
  machine_review_duplicate_of_title: string | null;
  created_at: string;
  updated_at: string;
};

export interface RecipeReviewRecord {
  id: string;
  title: string;
  cuisine: string | null;
  region: string | null;
  mealTypes: RecipeMealType[];
  dietTags: string[];
  flavorTags: string[];
  equipment: string[];
  activeTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  servings: number | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  ingredients: RecipeLibraryIngredient[];
  steps: RecipeLibraryStep[];
  storageNotes: string | null;
  reheatNotes: string | null;
  prepAheadNotes: string | null;
  toddlerTip: string | null;
  glucoseTip: string | null;
  status: RecipeStatus;
  sourceUrl: string | null;
  sourceAttribution: string | null;
  machineReview: RecipeMachineReviewSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapIngredients(value: unknown): RecipeLibraryIngredient[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RecipeLibraryIngredient[] => {
    if (!item || typeof item !== "object") return [];
    const ingredient = item as Record<string, unknown>;
    if (typeof ingredient.name !== "string") return [];
    return [{
      name: ingredient.name,
      quantity: typeof ingredient.quantity === "number" ? ingredient.quantity : Number(ingredient.quantity ?? 0),
      unit: typeof ingredient.unit === "string" ? ingredient.unit : "",
      prep: typeof ingredient.prep === "string" ? ingredient.prep : undefined,
      category: typeof ingredient.category === "string" ? ingredient.category : undefined,
      optional: Boolean(ingredient.optional),
    }];
  });
}

function mapSteps(value: unknown): RecipeLibraryStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index): RecipeLibraryStep[] => {
    if (!item || typeof item !== "object") return [];
    const step = item as Record<string, unknown>;
    if (typeof step.text !== "string") return [];
    return [{
      order: typeof step.order === "number" ? step.order : index + 1,
      text: step.text,
      timerMinutes: typeof step.timerMinutes === "number" ? step.timerMinutes : undefined,
    }];
  });
}

function mapMachineReviewIssues(value: unknown): RecipeMachineReviewSnapshot["issues"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RecipeMachineReviewSnapshot["issues"] => {
    if (!item || typeof item !== "object") return [];
    const issue = item as Record<string, unknown>;
    if (typeof issue.code !== "string" || typeof issue.message !== "string") return [];
    const severity = issue.severity;
    if (severity !== "info" && severity !== "warning" && severity !== "critical") return [];
    return [{ code: issue.code, message: issue.message, severity }];
  });
}

function mapStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapRecipeRow(row: ReviewRecipeRow): RecipeReviewRecord {
  const machineReview = row.machine_review_decision
    ? {
      decision: row.machine_review_decision,
      score: row.machine_review_score ?? 0,
      confidence: row.machine_review_confidence ?? 0,
      summary: row.machine_review_summary ?? "",
      issues: mapMachineReviewIssues(row.machine_review_issues),
      suggestedFixes: mapStringArray(row.machine_review_suggested_fixes),
      tags: asStringArray(row.machine_review_tags),
      duplicateOfRecipeId: row.machine_review_duplicate_of_recipe_id,
      duplicateOfTitle: row.machine_review_duplicate_of_title,
      model: row.machine_review_model,
      version: row.machine_review_version,
      reviewedAt: row.machine_reviewed_at,
    } satisfies RecipeMachineReviewSnapshot
    : null;

  return {
    id: row.id,
    title: row.title,
    cuisine: row.cuisine,
    region: row.region,
    mealTypes: asStringArray(row.meal_types) as RecipeMealType[],
    dietTags: asStringArray(row.diet_tags),
    flavorTags: asStringArray(row.flavor_tags),
    equipment: asStringArray(row.equipment),
    activeTimeMinutes: row.active_time_minutes,
    totalTimeMinutes: row.total_time_minutes,
    servings: row.servings,
    calories: row.calories,
    protein: row.protein,
    carbs: row.carbs,
    fats: row.fats,
    ingredients: mapIngredients(row.ingredients),
    steps: mapSteps(row.steps),
    storageNotes: row.storage_notes,
    reheatNotes: row.reheat_notes,
    prepAheadNotes: row.prep_ahead_notes,
    toddlerTip: row.toddler_tip,
    glucoseTip: row.glucose_tip,
    status: row.status,
    sourceUrl: row.source_url,
    sourceAttribution: row.source_attribution,
    machineReview,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getRecipeReviewAdminStatus(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export async function listRecipesForReview(): Promise<RecipeReviewRecord[]> {
  const { data, error } = await (supabase as unknown as {
    from(table: "recipe_library"): {
      select(columns: string): {
        order(column: string, options?: { ascending?: boolean }): Promise<{ data: ReviewRecipeRow[] | null; error: { message?: string } | null }>;
      };
    };
  })
    .from("recipe_library")
    .select("id,title,cuisine,region,meal_types,diet_tags,flavor_tags,equipment,active_time_minutes,total_time_minutes,servings,calories,protein,carbs,fats,ingredients,steps,storage_notes,reheat_notes,prep_ahead_notes,toddler_tip,glucose_tip,status,source_url,source_attribution,machine_reviewed_at,machine_review_model,machine_review_version,machine_review_decision,machine_review_score,machine_review_confidence,machine_review_summary,machine_review_issues,machine_review_suggested_fixes,machine_review_tags,machine_review_duplicate_of_recipe_id,machine_review_duplicate_of_title,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message ?? "Failed to load recipe review queue.");
  return (data ?? []).map(mapRecipeRow);
}

export async function updateRecipeStatuses(recipeIds: string[], status: RecipeStatus): Promise<void> {
  if (recipeIds.length === 0) return;
  const { error } = await (supabase as unknown as {
    from(table: "recipe_library"): {
      update(values: { status: RecipeStatus }): {
        in(column: string, values: string[]): Promise<{ error: { message?: string } | null }>;
      };
    };
  })
    .from("recipe_library")
    .update({ status })
    .in("id", recipeIds);

  if (error) throw new Error(error.message ?? "Failed to update recipe status.");
}
