ALTER TABLE public.meal_plans
ADD COLUMN pantry_items jsonb NOT NULL DEFAULT '[]'::jsonb;
