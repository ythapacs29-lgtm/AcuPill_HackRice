# Block 3 backend foundation

The event API and SQL migration are prepared; browser wiring and real-device/database verification are not complete.

1. Install `pg` in the project (`npm install pg`).
2. Create server/.env with DATABASE_URL (use Tiger Data's TLS-enabled connection), ACUPILL_PATIENT_ID and ACUPILL_DEVICE_ID (UUIDs). Do not commit it.
3. Apply server/schema.sql to the intended development database using the Tiger Data SQL editor. Review the target before applying; this creates four tables and a hypertable.
4. Run `node --env-file=server/.env server/index.mjs` from the project root.
5. Next, add a Vite /api proxy to port 3001 and a validated snake_case UI adapter with a persistent retry queue. POST only after the detector's accepted-event branch. Reload stored events through GET /api/events and adapt them to both existing views.

The API uses fixed demo patient/device scope and binds only to loopback. It has no production login/authentication. The database is authoritative for received_at. Event ID reuse with changed content is rejected. JSON context fields currently accept objects; tighten their schemas when baseline/schedule/3-of-5 implementations are shared. Do not expose this development API publicly.

Acceptance still required: real bottle event → POST → database row → GET → both dashboards; retry produces one row; rejected attempt produces none; database failure stays visibly pending; refresh retrieves the row. The migration was run through Tiger Cloud SQL Editor and all four tables, including the interaction hypertable, were verified. Local TLS connection and API round-trip testing remain pending.

## Local startup

Run `npm run db:check` to verify TLS and the schema without exposing credentials.
Run `npm run server` in one terminal and `npm run dev` in another.
The UI should use relative `/api/events` URLs; Vite forwards `/api` to port 3001.
`GET /api/health` returns 200 only when the database is reachable, otherwise 503.
Both servers are for local development. Port 5173 is fixed to match the current origin check.
No database credentials belong in frontend configuration.

## Temporary demo TLS workaround

Set `ACUPILL_DEV_INSECURE_TLS=true` only in local `server/.env` to retain encryption while skipping server identity verification. This is for synthetic hackathon demo data only. It is rejected when NODE_ENV=production. Remove the setting or set it to false to restore certificate verification; restart the backend afterward. This does not fix or authenticate the certificate chain.
