-- Add batch-model fields to persisted meal plans and recipe snapshots (Phase 17,
-- BATCH-01). meal_plans.batches carries the plan-level PrepBatch[] table;
-- recipes.batch_uses / recipes.batch_creates carry each recipe's consumption
-- (uses) and production (creates) references into that table.
--
-- All columns are additive/nullable — no RLS changes needed. meal_plans.batches
-- inherits the existing per-user RLS policy on public.meal_plans directly;
-- recipes.batch_uses/batch_creates inherit public.recipes' existing per-user RLS
-- policy via the day_id -> meal_plan_days -> meal_plans.user_id join chain (same
-- inheritance as the 20260708000000 precedent).

alter table public.meal_plans
  add column if not exists batches jsonb;

alter table public.recipes
  add column if not exists batch_uses jsonb,
  add column if not exists batch_creates text;

notify pgrst, 'reload schema';
