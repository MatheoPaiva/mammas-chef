-- Recipe Library + MVP RAG groundwork
-- Canonical reusable recipes, provenance, and purpose-built chunks for hybrid search.

create extension if not exists vector;

create table if not exists public.recipe_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text,
  author text,
  license text not null default 'unknown',
  usage_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.recipe_library (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.recipe_sources(id) on delete set null,
  title text not null,
  cuisine text,
  region text,
  meal_types text[] not null default '{}',
  diet_tags text[] not null default '{}',
  flavor_tags text[] not null default '{}',
  equipment text[] not null default '{}',
  active_time_minutes integer,
  total_time_minutes integer,
  servings numeric,
  calories integer,
  protein numeric,
  carbs numeric,
  fats numeric,
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  storage_notes text,
  reheat_notes text,
  prep_ahead_notes text,
  toddler_tip text,
  glucose_tip text,
  status text not null default 'draft',
  source_url text,
  source_attribution text,
  canonical_text text not null default '',
  search_vector tsvector generated always as (to_tsvector('english', canonical_text)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipe_library_title_unique unique (title),
  constraint recipe_library_status_check check (status in ('draft', 'reviewed', 'tested', 'archived')),
  constraint recipe_library_servings_positive check (servings is null or servings > 0),
  constraint recipe_library_times_nonnegative check (
    (active_time_minutes is null or active_time_minutes >= 0) and
    (total_time_minutes is null or total_time_minutes >= 0)
  )
);

create table if not exists public.recipe_chunks (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipe_library(id) on delete cascade,
  chunk_type text not null,
  chunk_index integer not null default 0,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  constraint recipe_chunks_type_check check (chunk_type in ('overview', 'ingredients', 'method', 'planning', 'shopping')),
  unique (recipe_id, chunk_type, chunk_index)
);

create index if not exists recipe_library_status_idx on public.recipe_library(status);
create index if not exists recipe_library_meal_types_idx on public.recipe_library using gin(meal_types);
create index if not exists recipe_library_diet_tags_idx on public.recipe_library using gin(diet_tags);
create index if not exists recipe_library_flavor_tags_idx on public.recipe_library using gin(flavor_tags);
create index if not exists recipe_library_search_vector_idx
  on public.recipe_library using gin(search_vector);
create index if not exists recipe_chunks_recipe_id_idx on public.recipe_chunks(recipe_id);
create index if not exists recipe_chunks_type_idx on public.recipe_chunks(chunk_type);
create index if not exists recipe_chunks_content_fts_idx
  on public.recipe_chunks using gin(to_tsvector('english', content));

alter table public.recipe_sources enable row level security;
alter table public.recipe_library enable row level security;
alter table public.recipe_chunks enable row level security;

create policy "Authenticated users can read recipe sources"
  on public.recipe_sources for select
  to authenticated
  using (true);

create policy "Authenticated users can read reviewed library recipes"
  on public.recipe_library for select
  to authenticated
  using (status in ('reviewed', 'tested'));

create policy "Authenticated users can read chunks for reviewed recipes"
  on public.recipe_chunks for select
  to authenticated
  using (
    exists (
      select 1 from public.recipe_library r
      where r.id = recipe_chunks.recipe_id
        and r.status in ('reviewed', 'tested')
    )
  );
