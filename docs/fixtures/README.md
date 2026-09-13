# Caregiver API fixtures

`events.synthetic.json` contains five synthetic events actually POSTed to the local backend, persisted in Tiger Data, and retrieved through GET /api/events. The capture filtered out any unrelated rows. All five generated rows were then deleted, leaving existing database history untouched. These are synthetic API integration examples, NOT real sensor measurements or evidence that M4–M10 detected them. detector_version identifies them as synthetic-fixture-v1.

`events.empty.json` is the empty-success contract. These files contain no database password or connection string. UUIDs are the configured demo patient/device identifiers.

## Use in the caregiver UI

Load the synthetic JSON through your development fixture mechanism and pass its `items` array to the same adapter used for live GET responses. Keep a visible Synthetic demo data label. Do not silently switch to these records when the live API fails: show an error/offline state instead.

For live use through the Vite proxy:

```js
const response = await fetch('/api/events')
if (!response.ok) throw new Error(`Events unavailable (${response.status})`)
const { items } = await response.json()
// Convert bigint-backed values before doing arithmetic:
const events = items.map(event => ({
  ...event,
  duration_ms: Number(event.duration_ms),
  device_uptime_ms: Number(event.device_uptime_ms),
}))
```

Start `npm run server` and `npm run dev` in separate terminals. The server requires private server/.env configuration. Direct backend check on the SAME computer:

```bash
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/events
```

## Types and scope

- recorded_at and received_at: ISO UTC timestamps; received_at is database-generated.
- duration_ms and device_uptime_ms: millisecond values returned as strings by pg for SQL bigint.
- sample_count: integer; touch_seen: boolean.
- max_tilt_degrees and average_tilt_degrees: degrees.
- Motion fields: derived scores, not clinical tremor values; do not label as velocity or force. Firmware acceleration units remain unconfirmed.
- baseline, percent_changes, schedule_match: nullable objects. These examples deliberately use null: the nested structure is not finalized and the backend does not calculate those fields. Render unavailable values as unavailable, not zero. These fixtures do not test the 3-of-5 Major Change engine.
- GET returns at most 100 events for the server-configured patient, newest first. No patient query parameter is supported yet.
- POST takes snake_case fields from docs/data-contract.md; do not send server-generated received_at back in POST.
- Local backend has no production authentication and binds to 127.0.0.1. Person B's localhost cannot reach Person A's Mac. A shared remote API still needs a separate deployment/access decision.

## Verification result

Five POST requests returned 201; GET returned all five generated events; cleanup verified zero remaining generated rows. Previous testing also verified identical retries return 200 and conflicting ID reuse returns 409. The current local demo connection is encrypted but uses the explicitly authorized ACUPILL_DEV_INSECURE_TLS=true setting; server identity verification is NOT complete, and production mode forbids the bypass.

Next integration checkpoint: agree on event-upload ownership in App.jsx, then connect accepted detector events and verify both views. M4–M10 and dashboard source files were not changed to create these fixtures.
