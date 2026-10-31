alter table public.profiles
  add column if not exists preferred_cuisines text[] not null default '{}';
