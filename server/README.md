# Block 3 backend foundation

The event API and SQL migration are prepared; browser wiring and real-device/database verification are not complete.

1. Install `pg` in the project (`npm install pg`).
2. Create server/.env with DATABASE_URL (use Tiger Data's TLS-enabled connection), ACUPILL_PATIENT_ID and ACUPILL_DEVICE_ID (UUIDs). Do not commit it.
3. Apply server/schema.sql to the intended development database using the Tiger Data SQL editor. Review the target before applying; this creates four tables and a hypertable.
4. Run `node --env-file=server/.env server/index.mjs` from the project root.
5. Next, add a Vite /api proxy to port 3001 and a validated snake_case UI adapter with a persistent retry queue. POST only after the detector's accepted-event branch. Reload stored events through GET /api/events and adapt them to both existing views.

The API uses fixed demo patient/device scope and binds only to loopback. It has no production login/authentication. The database is authoritative for received_at. Event ID reuse with changed content is rejected. JSON context fields currently accept objects; tighten their schemas when baseline/schedule/3-of-5 implementations are shared. Do not expose this development API publicly.

Acceptance still required: real bottle event → POST → database row → GET → both dashboards; retry produces one row; rejected attempt produces none; database failure stays visibly pending; refresh retrieves the row. No live database migration has been run by this change.
