-- Admin access table for beta testing log visibility.
-- Insert your Supabase user ID to grant admin read access:
--   INSERT INTO public.admins (user_id) VALUES ('<your-user-id>');
CREATE TABLE public.admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Admins can read all app_logs (bypasses the per-user SELECT policy)
CREATE POLICY "Admins can read all logs"
  ON public.app_logs
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid()));
