ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS week_start_day text NOT NULL DEFAULT 'Sunday';
