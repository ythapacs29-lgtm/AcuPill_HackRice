# MATLAB completed-session analysis

Implemented and verified locally on September 13, 2026 using MATLAB R2026a on Apple Silicon macOS.

## 1. New files

- `matlab/analyzeBottleMotion.m`: reference-vector tilt, roll and pitch.
- `matlab/analyzeSession.m`: completed-session numeric metrics.
- `matlab/analyzeSessionJson.m`: validated JSON boundary.
- `matlab/runMotionWorker.m`: persistent MATLAB inbox worker.
- `matlab/testMotion.m`: real MATLAB numerical tests.
- `server/matlab-worker.mjs`: bounded local worker lifecycle and request queue.
- `server/migrations/002-motion-analysis.sql`: three nullable columns.
- `src/services/motionAnalysis.js`: matching JS fallback and result contract checks.
- `tests/motion.test.mjs`: numeric, timeout, failure, upload retry and concurrency tests.
- `tests/detector.test.mjs`: executes actual App.jsx detector functions with isolated React setters.

## 2. Modified files

- `src/App.jsx`: captures the rest reference and triggering sample, queues a completed raw session, shows the latest analysis source and jerk in Engineering.
- `src/services/acupillApi.js`: analyzes queued sessions once, freezes processed results before POST and retries them unchanged.
- `server/index.mjs`: analysis/status endpoints, optional processed event fields, worker shutdown.
- `server/schema.sql`: nullable motion metadata for new and existing installations.

## 3. MATLAB calculations

Tilt is acosd of the clamped normalized dot product with the calibrated rest vector. Roll is atan2d(ay,az); pitch is atan2d(-ax,sqrt(ay^2+az^2)). Session outputs are duration, maximum/average tilt, total/average/peak motion, population motion standard deviation, average/peak jerk and sample count. Motion retains the original L1 acceleration delta. Jerk uses Euclidean acceleration delta divided by elapsed seconds; nonpositive elapsed intervals are skipped. Units follow the incoming acceleration units; this does not measure spatial position.

## 4. JavaScript responsibilities

Web Serial remains 115200 baud and `t_ms,touch,ax,ay,az`. JavaScript retains all live angle/motion checks, segmentation, touch validation, thresholds, cooldown, rejection decisions, patient history, baseline comparison and major-change logic. An accepted interaction is logged locally immediately. MATLAB subsequently computes storage metrics for that completed session; core results must agree with the original metrics within relative tolerance 1e-7. Local baseline/history still use the existing JS values.

## 5. Integration method

The Node backend launches one persistent licensed MATLAB process using `-batch`. Requests use a private temporary directory on the same machine, not an Engine API or a new MATLAB process per sample. MATLAB polls completed-session JSON jobs. A heartbeat retires the worker if its parent disappears. The API starts immediately while MATLAB warms up, with a 90-second startup limit. There are at most four pending analysis jobs, a 1.2-second server job timeout and a 1.5-second browser analysis timeout. Results arriving after timeout are discarded.

## 6. Contract and storage

`POST /api/motion/analyze` accepts `{samples:[{t_ms,ax,ay,az}], reference:{ax,ay,az}, initial_sample, start_ms, end_ms}`. The triggering sample is excluded from the legacy session list but included as `initial_sample` to preserve its first motion delta. There must be 2–10000 finite samples, nonzero vectors and valid boundaries; requests are limited to 1 MiB. The result contains existing event numeric keys plus `average_jerk`, `peak_jerk`, and tilt/roll/pitch arrays. Only aggregate fields reach `POST /api/events`; angle arrays and raw samples do not enter Tiger Data.

New nullable database fields: `average_jerk`, `peak_jerk`, `metrics_source` (`matlab` or `js_fallback`). Existing records remain unchanged with null metadata. Raw sessions may briefly remain in the local browser retry queue and private worker files; they are replaced with processed payloads before event upload.

`GET /api/motion/status` reports starting, ready or unavailable. This is distinct from `/api/health`, which checks the database.

## 7. Fallback behavior

Unavailable, busy, timed-out or invalid MATLAB results keep original JS metrics and add JS-computed jerk where valid. If even numeric fallback cannot analyze the raw session, the original accepted metrics remain and jerk is null. No MATLAB outcome reverses the detector's decision. The processed payload is persisted before POST, so retries preserve the same UUID and values even if MATLAB availability changes.

## 8. Verification performed

- Production Vite build passed.
- All 17 Node tests passed (7 existing API context tests, 6 actual detector scenarios, 4 numerical/fallback/queue tests).
- Actual MATLAB tests passed: orientation, stationary/moving sessions, jerk, duplicate clocks, invalid input and boundary compatibility.
- Running persistent MATLAB returned results matching JS for four numerical sessions.
- Live API rejected an invalid session with HTTP 400.
- A synthetic MATLAB event was POSTed to Tiger Data and retrieved through GET and a direct database query. Identical retry returned 200 and conflicting retry returned 409. Only that test row was deleted afterward.

## 9. Detector regression and remaining hardware check

Actual App.jsx detector tests cover valid tilt/return, touch-only, pickup without qualifying tilt, no-touch rejection, brief bump and shaky valid interaction. Valid cases also check state transitions and equality between the captured session's numerical metrics and the live detector's values. No thresholds or transition logic were changed. These are replayed synthetic samples; a fresh physical bottle interaction after this integration has not been observed by the agent. Reconnect Arduino if needed, perform one valid interaction, confirm Engineering says `Latest metrics: MATLAB`, then refresh live events in Care Team.

## 10. Runtime and restart

No MinGW, C/C++ compiler, MATLAB Engine package or additional toolbox is needed for this path. It uses MATLAB itself on macOS. Keep a valid MATLAB license available.

From the repository root, run `npm run server` and in a separate terminal `npm run dev`. The worker defaults to `/Applications/MATLAB_R2026a.app/bin/matlab`. Set `ACUPILL_MATLAB_BIN` to override this path on another machine; set `ACUPILL_MATLAB_DISABLED=true` to deliberately exercise fallback. Stopping the API stops its worker. On another database, apply `server/migrations/002-motion-analysis.sql` before using new metadata. The configured local demo database has already been migrated.

Run JS tests with `node --test server/context.test.mjs tests/*.test.mjs`. Run MATLAB tests with `matlab -batch "addpath('matlab'); testMotion"` from this repository, using the full MATLAB binary path if it is not on PATH.

This integration does not connect currently unavailable live baseline/schedule context, add authentication, or claim medication ingestion or clinical validation. Existing development TLS configuration is unchanged.
