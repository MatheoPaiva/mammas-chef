-- Fix recipes RLS policies: recipes has no user_id column.
-- Access must go through the join chain: recipes.day_id → meal_plan_days.meal_plan_id → meal_plans.user_id

DROP POLICY IF EXISTS "recipes_select" ON public.recipes;
DROP POLICY IF EXISTS "recipes_insert" ON public.recipes;
DROP POLICY IF EXISTS "recipes_update" ON public.recipes;
DROP POLICY IF EXISTS "recipes_delete" ON public.recipes;

CREATE POLICY "recipes_select" ON public.recipes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.meal_plan_days
      JOIN public.meal_plans ON meal_plans.id = meal_plan_days.meal_plan_id
      WHERE meal_plan_days.id = recipes.day_id
        AND meal_plans.user_id = auth.uid()
    )
  );

CREATE POLICY "recipes_insert" ON public.recipes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meal_plan_days
      JOIN public.meal_plans ON meal_plans.id = meal_plan_days.meal_plan_id
      WHERE meal_plan_days.id = recipes.day_id
        AND meal_plans.user_id = auth.uid()
    )
  );

CREATE POLICY "recipes_update" ON public.recipes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.meal_plan_days
      JOIN public.meal_plans ON meal_plans.id = meal_plan_days.meal_plan_id
      WHERE meal_plan_days.id = recipes.day_id
        AND meal_plans.user_id = auth.uid()
    )
  );

CREATE POLICY "recipes_delete" ON public.recipes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.meal_plan_days
      JOIN public.meal_plans ON meal_plans.id = meal_plan_days.meal_plan_id
      WHERE meal_plan_days.id = recipes.day_id
        AND meal_plans.user_id = auth.uid()
    )
  );
