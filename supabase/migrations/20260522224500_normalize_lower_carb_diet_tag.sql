-- Normalize the inconsistent "lower-carb" diet tag to the canonical "low-carb".
--
-- Background: any user with "Low-Carb" in profiles.dietary_preferences was
-- falling through from the fast retrieval-first meal-plan path to the slow
-- AI generation path because the substring matcher
-- `'lower-carb'.includes('low-carb')` returns false. A single recipe in the
-- library was tagged this way; renaming to the canonical token is the right
-- normalization. Idempotent and safe to re-run.
UPDATE recipe_library
SET diet_tags = (
  SELECT array_agg(CASE WHEN lower(t) = 'lower-carb' THEN 'low-carb' ELSE t END)
  FROM unnest(diet_tags) t
)
WHERE EXISTS (
  SELECT 1 FROM unnest(diet_tags) t WHERE lower(t) = 'lower-carb'
);
