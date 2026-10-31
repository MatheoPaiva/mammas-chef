-- Replace broad FOR ALL "CRUD" policies with explicit per-operation policies
-- for auditability and least-privilege clarity.

-- ============================================================
-- meal_plans
-- ============================================================
DROP POLICY IF EXISTS "Users can CRUD own meal plans" ON public.meal_plans;

ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_plans_select" ON public.meal_plans
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "meal_plans_insert" ON public.meal_plans
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "meal_plans_update" ON public.meal_plans
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "meal_plans_delete" ON public.meal_plans
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- meal_plan_days
-- ============================================================
DROP POLICY IF EXISTS "Users can CRUD own meal plan days" ON public.meal_plan_days;

ALTER TABLE public.meal_plan_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_plan_days_select" ON public.meal_plan_days
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.meal_plans
      WHERE meal_plans.id = meal_plan_days.meal_plan_id
        AND meal_plans.user_id = auth.uid()
    )
  );

CREATE POLICY "meal_plan_days_insert" ON public.meal_plan_days
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meal_plans
      WHERE meal_plans.id = meal_plan_days.meal_plan_id
        AND meal_plans.user_id = auth.uid()
    )
  );

CREATE POLICY "meal_plan_days_update" ON public.meal_plan_days
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.meal_plans
      WHERE meal_plans.id = meal_plan_days.meal_plan_id
        AND meal_plans.user_id = auth.uid()
    )
  );

CREATE POLICY "meal_plan_days_delete" ON public.meal_plan_days
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.meal_plans
      WHERE meal_plans.id = meal_plan_days.meal_plan_id
        AND meal_plans.user_id = auth.uid()
    )
  );

-- ============================================================
-- recipes
-- ============================================================
-- recipes has no user_id column. Ownership is transitive through the chain:
-- recipes.day_id → meal_plan_days.meal_plan_id → meal_plans.user_id.
-- The companion migration 20260312000000_fix_recipes_rls_policies.sql exists
-- because the original version of this block referenced a non-existent
-- recipes.user_id column and crashed on any fresh DB at statement 14.
-- The join form is now inlined here so this migration applies cleanly on
-- fresh environments (preview, branch, local); 312 then re-applies the same
-- definitions idempotently for environments that already ran the broken form.
DROP POLICY IF EXISTS "Users can CRUD own recipes" ON public.recipes;

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

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

-- ============================================================
-- shopping_lists
-- ============================================================
DROP POLICY IF EXISTS "Users can CRUD own shopping lists" ON public.shopping_lists;

ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shopping_lists_select" ON public.shopping_lists
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "shopping_lists_insert" ON public.shopping_lists
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "shopping_lists_update" ON public.shopping_lists
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "shopping_lists_delete" ON public.shopping_lists
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- favorite_recipes
-- ============================================================
DROP POLICY IF EXISTS "Users can CRUD own favorites" ON public.favorite_recipes;

ALTER TABLE public.favorite_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorite_recipes_select" ON public.favorite_recipes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "favorite_recipes_insert" ON public.favorite_recipes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "favorite_recipes_update" ON public.favorite_recipes
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "favorite_recipes_delete" ON public.favorite_recipes
  FOR DELETE USING (auth.uid() = user_id);
