-- Activity logging table for beta testing
CREATE TABLE public.app_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_type text NOT NULL,          -- 'page_view', 'action', 'error', 'api_error'
  event_name text NOT NULL,          -- e.g. 'generate_meal_plan', 'save_plan', '/planner'
  metadata jsonb DEFAULT '{}'::jsonb, -- extra context (error message, duration, etc.)
  page_url text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying by user and time
CREATE INDEX idx_app_logs_user_time ON public.app_logs (user_id, created_at DESC);
CREATE INDEX idx_app_logs_event_type ON public.app_logs (event_type, created_at DESC);

-- RLS: users can insert their own logs, admins can read all
ALTER TABLE public.app_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own logs"
  ON public.app_logs
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can read own logs"
  ON public.app_logs
  FOR SELECT
  USING (user_id = auth.uid());