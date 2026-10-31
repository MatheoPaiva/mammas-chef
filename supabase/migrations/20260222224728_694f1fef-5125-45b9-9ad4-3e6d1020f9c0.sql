
-- 1. Profiles table
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text DEFAULT '',
  household_size integer DEFAULT 2,
  dietary_preferences text[] DEFAULT '{}',
  allergies text[] DEFAULT '{}',
  toddler_friendly boolean DEFAULT false,
  glucose_friendly boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', ''));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 2. Meal plans table
CREATE TABLE public.meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL DEFAULT 'My Meal Plan',
  prep_tips jsonb DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own meal plans"
  ON public.meal_plans FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3. Meal plan days table
CREATE TABLE public.meal_plan_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id uuid REFERENCES public.meal_plans(id) ON DELETE CASCADE NOT NULL,
  day_name text NOT NULL
);

ALTER TABLE public.meal_plan_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own meal plan days"
  ON public.meal_plan_days FOR ALL
  TO authenticated
  USING (
    meal_plan_id IN (SELECT id FROM public.meal_plans WHERE user_id = auth.uid())
  )
  WITH CHECK (
    meal_plan_id IN (SELECT id FROM public.meal_plans WHERE user_id = auth.uid())
  );

-- 4. Recipes table
CREATE TABLE public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day_id uuid REFERENCES public.meal_plan_days(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  meal_type text NOT NULL,
  prep_time text DEFAULT '',
  servings integer DEFAULT 2,
  calories integer DEFAULT 0,
  protein integer DEFAULT 0,
  carbs integer DEFAULT 0,
  fats integer DEFAULT 0,
  tags jsonb DEFAULT '[]',
  ingredients jsonb DEFAULT '[]',
  steps jsonb DEFAULT '[]',
  toddler_tip text,
  glucose_tip text
);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own recipes"
  ON public.recipes FOR ALL
  TO authenticated
  USING (
    day_id IN (
      SELECT d.id FROM public.meal_plan_days d
      JOIN public.meal_plans p ON d.meal_plan_id = p.id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    day_id IN (
      SELECT d.id FROM public.meal_plan_days d
      JOIN public.meal_plans p ON d.meal_plan_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

-- 5. Shopping lists table
CREATE TABLE public.shopping_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id uuid REFERENCES public.meal_plans(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  items jsonb DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own shopping lists"
  ON public.shopping_lists FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
