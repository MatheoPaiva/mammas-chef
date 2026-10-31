-- Add CHECK constraints to recipes table to reject bad AI output at the DB level.
-- These are the last line of defense — validation should catch issues before insert.

-- Nutrition: calories must be positive, others non-negative
ALTER TABLE public.recipes
  ADD CONSTRAINT recipes_calories_positive CHECK (calories > 0),
  ADD CONSTRAINT recipes_protein_nonneg CHECK (protein >= 0),
  ADD CONSTRAINT recipes_carbs_nonneg CHECK (carbs >= 0),
  ADD CONSTRAINT recipes_fats_nonneg CHECK (fats >= 0);

-- Servings must be a positive integer
ALTER TABLE public.recipes
  ADD CONSTRAINT recipes_servings_positive CHECK (servings > 0);

-- prep_time should not be null (already has a DEFAULT '' but no NOT NULL)
ALTER TABLE public.recipes
  ALTER COLUMN prep_time SET NOT NULL;
