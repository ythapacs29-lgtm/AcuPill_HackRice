BEGIN;
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE IF NOT EXISTS interaction_events (
  event_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  device_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  device_uptime_ms bigint NOT NULL CHECK (device_uptime_ms >= 0),
  detector_version text NOT NULL,
  duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
  touch_seen boolean NOT NULL,
  max_tilt_degrees double precision NOT NULL CHECK (max_tilt_degrees BETWEEN 0 AND 180),
  average_tilt_degrees double precision NOT NULL CHECK (average_tilt_degrees BETWEEN 0 AND 180),
  total_motion_score double precision NOT NULL CHECK (total_motion_score >= 0),
  average_motion_score double precision NOT NULL CHECK (average_motion_score >= 0),
  peak_motion_score double precision NOT NULL CHECK (peak_motion_score >= 0),
  motion_variability_score double precision NOT NULL CHECK (motion_variability_score >= 0),
  sample_count integer NOT NULL CHECK (sample_count > 0),
  baseline jsonb,
  percent_changes jsonb,
  schedule_match jsonb,
  PRIMARY KEY (event_id, recorded_at)
);
SELECT create_hypertable('interaction_events', by_range('recorded_at'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS interaction_patient_time ON interaction_events(patient_id, recorded_at DESC);
CREATE TABLE IF NOT EXISTS medication_schedules (
  schedule_id uuid PRIMARY KEY, patient_id uuid NOT NULL,
  label text NOT NULL, local_time time NOT NULL, time_zone text NOT NULL,
  enabled boolean NOT NULL DEFAULT true, version integer NOT NULL,
  effective_from timestamptz NOT NULL, effective_to timestamptz
);
CREATE TABLE IF NOT EXISTS patient_checkins (
  checkin_id uuid PRIMARY KEY, patient_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  schema_version integer NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS major_changes (
  change_id uuid PRIMARY KEY, patient_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  rule_version text NOT NULL, rule_name text NOT NULL CHECK (rule_name = '3_of_5'),
  evidence jsonb NOT NULL, payload jsonb NOT NULL
);
COMMIT;
