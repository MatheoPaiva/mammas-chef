-- Admin-only review workflow for recipe library drafts.

create policy "Users can read own admin membership"
  on public.admins
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Admins can read all library recipes"
  on public.recipe_library
  for select
  to authenticated
  using (exists (
    select 1 from public.admins
    where user_id = auth.uid()
  ));

create policy "Admins can update library recipes"
  on public.recipe_library
  for update
  to authenticated
  using (exists (
    select 1 from public.admins
    where user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.admins
    where user_id = auth.uid()
  ));
