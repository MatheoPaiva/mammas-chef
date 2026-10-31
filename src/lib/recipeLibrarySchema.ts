import { z } from "zod";

export const recipeMealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export const recipeStatusSchema = z.enum(["draft", "reviewed", "tested", "archived"]);

export const recipeSourceSchema = z.object({
  name: z.string().trim().min(1),
  url: z.string().url().nullable().optional(),
  author: z.string().trim().min(1).nullable().optional(),
  license: z.string().trim().min(1),
  usageNotes: z.string().trim().nullable().optional(),
});

export const recipeLibraryIngredientSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().positive(),
  unit: z.string().trim(),
  prep: z.string().trim().optional(),
  category: z.string().trim().optional(),
  optional: z.boolean().optional().default(false),
});

export const recipeLibraryStepSchema = z.object({
  order: z.number().int().positive(),
  text: z.string().trim().min(1),
  timerMinutes: z.number().int().positive().optional(),
});

export const recipeLibraryInputSchema = z.object({
  title: z.string().trim().min(1),
  cuisine: z.string().trim().optional(),
  region: z.string().trim().optional(),
  mealTypes: z.array(recipeMealTypeSchema).min(1),
  dietTags: z.array(z.string().trim().min(1)).default([]),
  flavorTags: z.array(z.string().trim().min(1)).default([]),
  equipment: z.array(z.string().trim().min(1)).default([]),
  activeTimeMinutes: z.number().int().nonnegative().optional(),
  totalTimeMinutes: z.number().int().positive().optional(),
  servings: z.number().positive(),
  nutrition: z.object({
    calories: z.number().int().positive().optional(),
    protein: z.number().nonnegative().optional(),
    carbs: z.number().nonnegative().optional(),
    fats: z.number().nonnegative().optional(),
  }).optional(),
  ingredients: z.array(recipeLibraryIngredientSchema).min(1),
  steps: z.array(recipeLibraryStepSchema).min(1),
  storageNotes: z.string().trim().optional(),
  reheatNotes: z.string().trim().optional(),
  prepAheadNotes: z.string().trim().optional(),
  toddlerTip: z.string().trim().optional(),
  glucoseTip: z.string().trim().optional(),
  status: recipeStatusSchema.default("draft"),
  source: recipeSourceSchema,
}).superRefine((recipe, ctx) => {
  if (recipe.activeTimeMinutes && recipe.totalTimeMinutes && recipe.activeTimeMinutes > recipe.totalTimeMinutes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "activeTimeMinutes cannot be greater than totalTimeMinutes",
      path: ["activeTimeMinutes"],
    });
  }

  const orders = recipe.steps.map((step) => step.order);
  if (new Set(orders).size !== orders.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "step order values must be unique",
      path: ["steps"],
    });
  }
});

export const recipeLibraryCollectionSchema = z.array(recipeLibraryInputSchema).min(1);

export type RecipeLibraryInputFromSchema = z.infer<typeof recipeLibraryInputSchema>;
