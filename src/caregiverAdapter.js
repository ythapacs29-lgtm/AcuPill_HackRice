// Convert API rows into the compact shape used by the caregiver preview.
const number = value => value == null || value === '' || typeof value === 'boolean'
  ? null : Number.isFinite(Number(value)) ? Number(value) : null
export function adaptCaregiverEvents(rows, patientId) {
  if (!Array.isArray(rows)) throw new TypeError('Expected an array of events')
  const seen = new Set()
  return rows.filter(row => {
    if (!row || row.patient_id !== patientId || !row.event_id) return false
    if (!Number.isFinite(Date.parse(row.recorded_at)) || seen.has(row.event_id)) return false
    seen.add(row.event_id)
    return true
  }).map(row => {
    const baseline = row.baseline
    const percentages = row.percent_changes
    const hasBaseline = baseline && typeof baseline === 'object' &&
      Number.isInteger(number(baseline.event_count)) && number(baseline.event_count) >= 3 &&
      baseline.means && typeof baseline.means === 'object'
    const values = percentages && typeof percentages.values === 'object' && percentages.values || {}
    const schedule = row.schedule_match && typeof row.schedule_match === 'object' ? row.schedule_match : null
    return {
      id: row.event_id, recordedAt: new Date(row.recorded_at).toISOString(),
      duration: number(row.duration_ms), motion: number(row.total_motion_score),
      variability: number(row.motion_variability_score),
      baselineEventCount: hasBaseline ? number(baseline.event_count) : null,
      durationChange: number(values.duration_ms), motionChange: number(values.total_motion_score),
      variabilityChange: number(values.motion_variability_score),
      scheduleStatus: ['recorded', 'late'].includes(schedule?.status) ? schedule.status : null,
    }
  }).sort((a,b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
}

// Captured synthetic fixture; never uploaded by the preview.
export const mockCaregiverEvents = [
  {
    "event_id": "28d550f7-dcc4-48a5-a84a-51d5eb2fbebc",
    "patient_id": "5e22c7c9-b8d8-4076-814f-87f59d42ce4a",
    "device_id": "70064ad6-90ac-430a-94e5-84e0ddeb2c4d",
    "recorded_at": "2026-09-13T03:42:14.652Z",
    "received_at": "2026-09-13T04:42:14.756Z",
    "device_uptime_ms": "90000",
    "detector_version": "synthetic-fixture-v1",
    "duration_ms": "3000",
    "touch_seen": true,
    "max_tilt_degrees": 52,
    "average_tilt_degrees": 29,
    "total_motion_score": 1.4,
    "average_motion_score": 0.14,
    "peak_motion_score": 0.33,
    "motion_variability_score": 0.08,
    "sample_count": 10,
    "baseline": {
      "means": {
        "duration_ms": 2250,
        "max_tilt_degrees": 43,
        "peak_motion_score": 0.27,
        "total_motion_score": 1.0999999999999999,
        "average_motion_score": 0.11,
        "average_tilt_degrees": 26,
        "motion_variability_score": 0.049999999999999996
      },
      "event_ids": [
        "c3df62bc-55a4-49fb-8f6c-6a2029e24ef2",
        "508f58ed-8862-4146-b8f8-6fb12f4b5ce8",
        "dfd0378f-ca88-43d4-952e-9c412f630ee9"
      ],
      "event_count": 3,
      "algorithm_version": "prior-mean-v1"
    },
    "percent_changes": {
      "values": {
        "duration_ms": 33.33333333333333,
        "max_tilt_degrees": 20.930232558139537,
        "peak_motion_score": 22.22222222222222,
        "total_motion_score": 27.27272727272728,
        "average_motion_score": 27.27272727272728,
        "average_tilt_degrees": 11.538461538461538,
        "motion_variability_score": 60.00000000000002
      },
      "algorithm_version": "relative-percent-v1"
    },
    "schedule_match": {
      "status": "recorded",
      "schedule_id": "10000000-0000-4000-8000-000000000001",
      "scheduled_at": "2026-09-13T03:42:14.652Z",
      "algorithm_version": "synthetic-window-v1"
    }
  },
  {
    "event_id": "1954eb43-af2c-48ba-b2e0-438a25708cc4",
    "patient_id": "5e22c7c9-b8d8-4076-814f-87f59d42ce4a",
    "device_id": "70064ad6-90ac-430a-94e5-84e0ddeb2c4d",
    "recorded_at": "2026-09-13T02:42:14.452Z",
    "received_at": "2026-09-13T04:42:14.557Z",
    "device_uptime_ms": "70000",
    "detector_version": "synthetic-fixture-v1",
    "duration_ms": "2750",
    "touch_seen": true,
    "max_tilt_degrees": 49,
    "average_tilt_degrees": 28,
    "total_motion_score": 1.3,
    "average_motion_score": 0.13,
    "peak_motion_score": 0.31,
    "motion_variability_score": 0.07,
    "sample_count": 10,
    "baseline": {
      "means": {
        "duration_ms": 2250,
        "max_tilt_degrees": 43,
        "peak_motion_score": 0.27,
        "total_motion_score": 1.0999999999999999,
        "average_motion_score": 0.11,
        "average_tilt_degrees": 26,
        "motion_variability_score": 0.049999999999999996
      },
      "event_ids": [
        "c3df62bc-55a4-49fb-8f6c-6a2029e24ef2",
        "508f58ed-8862-4146-b8f8-6fb12f4b5ce8",
        "dfd0378f-ca88-43d4-952e-9c412f630ee9"
      ],
      "event_count": 3,
      "algorithm_version": "prior-mean-v1"
    },
    "percent_changes": null,
    "schedule_match": null
  },
  {
    "event_id": "dfd0378f-ca88-43d4-952e-9c412f630ee9",
    "patient_id": "5e22c7c9-b8d8-4076-814f-87f59d42ce4a",
    "device_id": "70064ad6-90ac-430a-94e5-84e0ddeb2c4d",
    "recorded_at": "2026-09-13T01:42:14.255Z",
    "received_at": "2026-09-13T04:42:14.358Z",
    "device_uptime_ms": "50000",
    "detector_version": "synthetic-fixture-v1",
    "duration_ms": "2500",
    "touch_seen": true,
    "max_tilt_degrees": 46,
    "average_tilt_degrees": 27,
    "total_motion_score": 1.2,
    "average_motion_score": 0.12000000000000001,
    "peak_motion_score": 0.29,
    "motion_variability_score": 0.06,
    "sample_count": 10,
    "baseline": null,
    "percent_changes": null,
    "schedule_match": null
  },
  {
    "event_id": "508f58ed-8862-4146-b8f8-6fb12f4b5ce8",
    "patient_id": "5e22c7c9-b8d8-4076-814f-87f59d42ce4a",
    "device_id": "70064ad6-90ac-430a-94e5-84e0ddeb2c4d",
    "recorded_at": "2026-09-13T00:42:14.052Z",
    "received_at": "2026-09-13T04:42:14.157Z",
    "device_uptime_ms": "30000",
    "detector_version": "synthetic-fixture-v1",
    "duration_ms": "2250",
    "touch_seen": true,
    "max_tilt_degrees": 43,
    "average_tilt_degrees": 26,
    "total_motion_score": 1.1,
    "average_motion_score": 0.11,
    "peak_motion_score": 0.27,
    "motion_variability_score": 0.05,
    "sample_count": 10,
    "baseline": null,
    "percent_changes": null,
    "schedule_match": null
  },
  {
    "event_id": "c3df62bc-55a4-49fb-8f6c-6a2029e24ef2",
    "patient_id": "5e22c7c9-b8d8-4076-814f-87f59d42ce4a",
    "device_id": "70064ad6-90ac-430a-94e5-84e0ddeb2c4d",
    "recorded_at": "2026-09-12T23:42:13.545Z",
    "received_at": "2026-09-13T04:42:13.930Z",
    "device_uptime_ms": "10000",
    "detector_version": "synthetic-fixture-v1",
    "duration_ms": "2000",
    "touch_seen": true,
    "max_tilt_degrees": 40,
    "average_tilt_degrees": 25,
    "total_motion_score": 1,
    "average_motion_score": 0.1,
    "peak_motion_score": 0.25,
    "motion_variability_score": 0.04,
    "sample_count": 10,
    "baseline": null,
    "percent_changes": null,
    "schedule_match": null
  }
]
