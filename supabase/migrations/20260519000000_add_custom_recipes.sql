-- Private user-owned custom recipes. Saved meal plans keep full recipe snapshots,
-- while custom_recipe_id preserves source traceability when available.

create table if not exists public.custom_recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  servings integer not null check (servings > 0),
  prep_time_minutes integer check (prep_time_minutes is null or prep_time_minutes >= 0),
  tags jsonb not null default '[]'::jsonb,
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  toddler_tip text,
  glucose_tip text,
  flavor_notes text,
  calories integer not null check (calories > 0),
  protein integer not null check (protein >= 0),
  carbs integer not null check (carbs >= 0),
  fats integer not null check (fats >= 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.custom_recipes enable row level security;

create policy "custom_recipes_select_own"
  on public.custom_recipes for select
  to authenticated
  using (user_id = auth.uid());

create policy "custom_recipes_insert_own"
  on public.custom_recipes for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "custom_recipes_update_own"
  on public.custom_recipes for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "custom_recipes_delete_own"
  on public.custom_recipes for delete
  to authenticated
  using (user_id = auth.uid());

create index if not exists custom_recipes_user_status_updated_idx
  on public.custom_recipes(user_id, status, updated_at desc);

create or replace function public.touch_custom_recipes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_custom_recipes_updated_at on public.custom_recipes;
create trigger touch_custom_recipes_updated_at
  before update on public.custom_recipes
  for each row
  execute function public.touch_custom_recipes_updated_at();

alter table public.recipes
  add column if not exists custom_recipe_id uuid references public.custom_recipes(id) on delete set null;

create index if not exists recipes_custom_recipe_id_idx on public.recipes(custom_recipe_id);

notify pgrst, 'reload schema';
