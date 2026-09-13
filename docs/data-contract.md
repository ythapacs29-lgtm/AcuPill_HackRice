# AcuPill shared contract v1

This replaces the earlier camelCase draft with the team's agreed snake_case contract. Existing UI objects need an adapter; do not rename detector fields blindly.

## Stored events

Only interactions accepted by the current M4–M10 detector become `interaction_events`. Rejected attempts stay in Engineering/debug data. A bottle interaction is not proof of ingestion. All motion values are derived motion scores, not clinical tremor measurements.

Required identity/time fields: `event_id` UUID generated once, `patient_id` UUID, `device_id` UUID, `recorded_at` ISO UTC client timestamp, `device_uptime_ms` nonnegative integer, `detector_version` nonempty string. Backend adds `received_at` independently. Preserve event_id and recorded_at on retries.

Required metrics: `duration_ms`, `touch_seen` boolean, `max_tilt_degrees`, `average_tilt_degrees`, `total_motion_score`, `average_motion_score`, `peak_motion_score`, `motion_variability_score`, `sample_count`. Numeric values must be finite and nonnegative; sample_count is a positive integer. Tilt is in degrees, at most 180.

Context fields (nullable until established): `baseline` (version, source event IDs, sample size, metric means); `percent_changes` (metric-to-percent mapping, null when reference is zero/unavailable); `schedule_match` (schedule ID, scheduled_at ISO instant, matching algorithm version, status). Never turn unavailable baselines into zero measurements. Snapshot context at classification time, so later history does not silently rewrite past interpretations.

## Tables

- `interaction_events`: hypertable partitioned on recorded_at. Composite key (event_id, recorded_at), because a hypertable unique key must include its time partition. The first local API serializes inserts per event_id and rejects reuse with different content/time.
- `medication_schedules`: normal table with patient_id, local time, IANA timezone, enabled flag, label and version/effective date metadata.
- `patient_checkins`: normal table for patient-entered records, timestamp and versioned payload.
- `major_changes`: normal table for derived 3-of-5 repeated-deviation markers, rule version and evidence event references. Do not replace the existing rule with a one-event threshold. The current checkout shows a placeholder; obtain the existing implementation/thresholds before wiring this writer.

## Block 3 API

`POST /api/events`: validate a canonical event, persist and return `{ event }`. Retry identical event_id + recorded_at without creating another row. Reject conflicting ID reuse. `GET /api/events`: return `{ items }` for the configured patient, newest first, bounded to 100 events for the first integration loop. Backend scope comes from server configuration, not the browser's role selector.

First development server is localhost-only and single demo patient/device. It is not a production authentication system. Use a server-only DATABASE_URL, never a VITE database secret. No historical localStorage upload without explicit ownership. Keep failed uploads local and visibly pending.

Patient and caregiver views read the same records; patient wording stays simple/non-clinical, caregiver views show percentages/trends. UI integration must use a canonical-to-legacy adapter while the dashboard still expects camelCase.
