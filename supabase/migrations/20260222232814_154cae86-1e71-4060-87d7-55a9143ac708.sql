
CREATE TABLE public.favorite_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  recipe_title text NOT NULL,
  recipe_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.favorite_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own favorites"
ON public.favorite_recipes
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
