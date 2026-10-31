-- Notify PostgREST to reload its schema cache so preferred_cuisines column is visible
NOTIFY pgrst, 'reload schema';
