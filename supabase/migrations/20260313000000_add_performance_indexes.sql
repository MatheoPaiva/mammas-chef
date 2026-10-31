-- Performance indexes for common query patterns

-- 1. Loading a user's meal plan history (ordered by most recent)
CREATE INDEX IF NOT EXISTS idx_meal_plans_user_created
  ON public.meal_plans (user_id, created_at DESC);

-- 2. Joining meal_plan_days with their parent meal_plan
CREATE INDEX IF NOT EXISTS idx_meal_plan_days_meal_plan_id
  ON public.meal_plan_days (meal_plan_id);

-- 3. Looking up recipes by day
CREATE INDEX IF NOT EXISTS idx_recipes_day_id
  ON public.recipes (day_id);

-- 4. Filtering favorite recipes by user
CREATE INDEX IF NOT EXISTS idx_favorite_recipes_user_id
  ON public.favorite_recipes (user_id);

-- 5. Loading a user's shopping lists
CREATE INDEX IF NOT EXISTS idx_shopping_lists_user_id
  ON public.shopping_lists (user_id);
