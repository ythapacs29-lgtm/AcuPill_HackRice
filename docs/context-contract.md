# Nested event context v1 — proposal for Person B review

This shape is now enforced for non-null context on POST by server/event-context.mjs. Null/omitted context remains supported. Coordinate before treating these field names as a team agreement. The existing detector and dashboard were not changed.

## baseline

Null means no usable baseline. Otherwise:

```json
{
  "algorithm_version": "prior-mean-v1",
  "event_ids": ["<prior-event-uuid-1>", "<prior-event-uuid-2>", "<prior-event-uuid-3>"],
  "event_count": 3,
  "means": {
    "duration_ms": 2250,
    "max_tilt_degrees": 43,
    "average_tilt_degrees": 26,
    "total_motion_score": 1.1,
    "average_motion_score": 0.11,
    "peak_motion_score": 0.27,
    "motion_variability_score": 0.05
  }
}
```

Use 3–100 distinct earlier valid events from the same patient and compatible detector/sampling conditions; exclude the current event. event_count equals the reference count. All seven means are required finite nonnegative numbers, tilt at most 180 degrees. The first three samples in the new fixture have no baseline; later examples reference those samples. This is not a clinical baseline.

## percent_changes

Null means comparison unavailable/not calculated. Otherwise `{ "algorithm_version": "relative-percent-v1", "values": { ... } }`. values has exactly the same seven metric keys as baseline.means. Compute `(current - mean) / mean * 100`. A zero mean requires null for that metric. Signed percentages are allowed. The API verifies values against supplied event metrics and means, with a floating-point tolerance; a non-null percentage object requires a baseline. These are percentages, not fractional ratios.

## schedule_match

Null means no match. Otherwise:

```json
{
  "schedule_id": "10000000-0000-4000-8000-000000000001",
  "scheduled_at": "2026-09-13T08:00:00.000Z",
  "status": "recorded",
  "algorithm_version": "window-v1"
}
```

Allowed statuses for a matched event: recorded or late. Pending/missing/upcoming belong to schedule occurrences, not matched events. scheduled_at is canonical UTC ISO with milliseconds. The fixture schedule UUID is illustrative; no medication schedule row was seeded. Matching windows remain the existing workflow's 30-minute early / 60-minute recorded / 180-minute late windows, to be implemented in the matching layer.

## Explicit limits

Validation checks structure and percentage arithmetic. It does NOT query reference existence, prove chronological order/patient ownership of baseline references, validate schedule timing against stored schedules, calculate baselines, or run the 3-of-5 rule. Those belong to later service integration. Accepted-event gating remains the detector's responsibility. Context is a snapshot rather than an automatically recalculated view.

## Verified fixture

`docs/fixtures/events.context.synthetic.json`: five synthetic events actually stored through POST and retrieved through GET. Covers all-null context, populated baseline with null percentages/match, and fully populated context. All generated event rows were removed after capture. Detector version synthetic-fixture-v1 marks every record as synthetic. received_at came from the database; bigint fields remain strings. No real patient data or database credentials are included.

Checks: `node --test server/context.test.mjs`. Live demo checks verified populated JSON retries return 200 and incorrect percentages return 400. TLS encryption remains on with the authorized development-only certificate-verification bypass; strict TLS is unresolved.
