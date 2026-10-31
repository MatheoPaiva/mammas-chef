ALTER TABLE public.meal_plans
ADD COLUMN skip_slots jsonb NOT NULL DEFAULT '{}'::jsonb;
