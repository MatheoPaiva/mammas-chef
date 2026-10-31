alter table public.recipe_library
  add column if not exists machine_reviewed_at timestamptz,
  add column if not exists machine_review_model text,
  add column if not exists machine_review_version text,
  add column if not exists machine_review_decision text,
  add column if not exists machine_review_score integer,
  add column if not exists machine_review_confidence numeric(4, 3),
  add column if not exists machine_review_summary text,
  add column if not exists machine_review_issues jsonb not null default '[]'::jsonb,
  add column if not exists machine_review_suggested_fixes jsonb not null default '[]'::jsonb,
  add column if not exists machine_review_tags text[] not null default '{}'::text[],
  add column if not exists machine_review_duplicate_of_recipe_id uuid references public.recipe_library(id) on delete set null,
  add column if not exists machine_review_duplicate_of_title text;

alter table public.recipe_library
  drop constraint if exists recipe_library_machine_review_decision_check;

alter table public.recipe_library
  add constraint recipe_library_machine_review_decision_check
  check (
    machine_review_decision is null
    or machine_review_decision in ('approve', 'review', 'reject')
  );

create index if not exists recipe_library_machine_review_decision_idx
  on public.recipe_library(machine_review_decision);

create index if not exists recipe_library_machine_review_duplicate_idx
  on public.recipe_library(machine_review_duplicate_of_recipe_id);
