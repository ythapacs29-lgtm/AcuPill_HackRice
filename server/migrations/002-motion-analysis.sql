BEGIN;
ALTER TABLE public.interaction_events ADD COLUMN IF NOT EXISTS average_jerk double precision;
ALTER TABLE public.interaction_events ADD COLUMN IF NOT EXISTS peak_jerk double precision;
ALTER TABLE public.interaction_events ADD COLUMN IF NOT EXISTS metrics_source text;
COMMIT;
