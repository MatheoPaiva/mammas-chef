-- Link saved meal-plan recipe snapshots back to canonical library recipes when applicable.
-- Plans still store a full snapshot so they remain stable if the library recipe changes later.

alter table public.recipes
  add column if not exists library_recipe_id uuid references public.recipe_library(id) on delete set null;

create index if not exists recipes_library_recipe_id_idx on public.recipes(library_recipe_id);
