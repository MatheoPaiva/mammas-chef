-- Add structured status/workflow/storage/time-breakdown fields to persisted recipe
-- snapshots (Phase 15, MEAL-01/02/03). Also fixes the pre-existing gap where
-- source_meal_id (added to the AI schema in Plan 07-01) was never persisted to
-- public.recipes, silently resetting leftover provenance on every save/reload.
--
-- All columns are additive/nullable — no RLS changes needed, new columns inherit
-- public.recipes' existing per-user RLS policy via the day_id -> meal_plan_days ->
-- meal_plans.user_id join chain.

alter table public.recipes
  add column if not exists source_meal_id text,
  add column if not exists status text check (status is null or status in ('fresh', 'prep-linked', 'leftover')),
  add column if not exists caution_note text,
  add column if not exists workflow text,
  add column if not exists storage text,
  add column if not exists cook_time text,
  add column if not exists total_time text;

notify pgrst, 'reload schema';
