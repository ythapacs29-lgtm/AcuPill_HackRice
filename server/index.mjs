import { createMatlabWorker } from './matlab-worker.mjs'
import { analyzeSessionJS } from '../src/services/motionAnalysis.js'
import http from 'node:http'
import { isDeepStrictEqual } from 'node:util'
import { validEventContext } from './event-context.mjs'
import pg from 'pg'
import { databaseConfig } from './db-config.mjs'

const { DATABASE_URL, ACUPILL_PATIENT_ID, ACUPILL_DEVICE_ID } = process.env
if (!DATABASE_URL || !ACUPILL_PATIENT_ID || !ACUPILL_DEVICE_ID) {
  throw new Error('Set DATABASE_URL, ACUPILL_PATIENT_ID and ACUPILL_DEVICE_ID in server/.env')
}
const pool = new pg.Pool(databaseConfig())
const motionWorker = createMatlabWorker()
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => {
  await motionWorker.stop(); await pool.end(); process.exit(0)
})
const fields = ['event_id','patient_id','device_id','recorded_at','device_uptime_ms','detector_version','duration_ms','touch_seen','max_tilt_degrees','average_tilt_degrees','total_motion_score','average_motion_score','peak_motion_score','motion_variability_score','sample_count','baseline','percent_changes','schedule_match','average_jerk','peak_jerk','metrics_source']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function validate(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false
  if (Object.keys(e).some(k => !fields.includes(k))) return false
  if (!['event_id','patient_id','device_id'].every(k => uuid.test(e[k]))) return false
  if (e.patient_id !== ACUPILL_PATIENT_ID || e.device_id !== ACUPILL_DEVICE_ID) return false
  if (typeof e.recorded_at !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(e.recorded_at) || !Number.isFinite(Date.parse(e.recorded_at))) return false
  if (typeof e.detector_version !== 'string' || !e.detector_version.trim() || e.detector_version.length > 100 || typeof e.touch_seen !== 'boolean') return false
  if (!['duration_ms','device_uptime_ms','sample_count'].every(k => Number.isSafeInteger(e[k]) && e[k] >= 0) || e.sample_count < 1) return false
  if (!fields.slice(8,14).every(k => Number.isFinite(e[k]) && e[k] >= 0)) return false
  if (e.max_tilt_degrees > 180 || e.average_tilt_degrees > 180) return false
  if (['average_jerk','peak_jerk'].some(k => e[k]!=null && (!Number.isFinite(e[k]) || e[k]<0))) return false
  if (e.metrics_source!=null && !['matlab','js_fallback'].includes(e.metrics_source)) return false
  return validEventContext(e)
}
const send = (res, status, body) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(body)) }
http.createServer(async (req,res) => {
  // No CORS allowance: use the same-origin Vite proxy during the local demo.
  if (req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(req.headers.origin)) return send(res,403,{error:'Origin not allowed'})
  if (req.url === '/api/motion/status' && req.method === 'GET') return send(res,200,{status:motionWorker.status()})
  if (req.url === '/api/motion/analyze') {
    if (req.method !== 'POST') return send(res,405,{error:'Method not allowed'})
    let body=''
    try {
      for await (const chunk of req) {body+=chunk;if(Buffer.byteLength(body)>1048576)return send(res,413,{error:'Session too large'})}
    } catch {return send(res,400,{error:'Incomplete motion session'})}
    let session
    try {session=JSON.parse(body);analyzeSessionJS(session)} catch {return send(res,400,{error:'Invalid motion session'})}
    try {return send(res,200,await motionWorker.analyze(session))}
    catch {return send(res,503,{error:'MATLAB unavailable; use JavaScript metrics'})}
  }
  if (req.url === '/api/health' && req.method === 'GET') {
    try {
      await pool.query('SELECT 1')
      return send(res,200,{status:'ready',database:'connected'})
    } catch { return send(res,503,{status:'unavailable',database:'disconnected'}) }
  }
  if (req.url !== '/api/events') return send(res,404,{error:'Not found'})
  try {
    if (req.method === 'GET') {
      const result = await pool.query('SELECT * FROM interaction_events WHERE patient_id=$1 ORDER BY recorded_at DESC,event_id DESC LIMIT 100',[ACUPILL_PATIENT_ID])
      return send(res,200,{items:result.rows})
    }
    if (req.method !== 'POST') return send(res,405,{error:'Method not allowed'})
    let body = ''
    for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body)>32768) return send(res,413,{error:'Event too large'}) }
    let e
    try { e=JSON.parse(body) } catch { return send(res,400,{error:'Invalid JSON'}) }
    if (!validate(e)) return send(res,400,{error:'Invalid event or patient/device scope'})
    e.recorded_at = new Date(e.recorded_at).toISOString()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[e.event_id])
      const existing = await client.query('SELECT * FROM interaction_events WHERE event_id=$1',[e.event_id])
      if (existing.rows.length) {
        const row=existing.rows[0]
        const equal=fields.every(k => k==='recorded_at' ? row[k].toISOString()===e[k] : ['device_uptime_ms','duration_ms'].includes(k) ? Number(row[k])===e[k] : isDeepStrictEqual(row[k] ?? null,e[k] ?? null))
        await client.query('COMMIT')
        return send(res,equal?200:409,equal?{event:row}:{error:'event_id already exists with different content'})
      }
      const values=fields.map(k=>e[k] ?? null)
      const result=await client.query(`INSERT INTO interaction_events (${fields.join(',')}) VALUES (${fields.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,values)
      await client.query('COMMIT')
      send(res,201,{event:result.rows[0]})
    } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  } catch { send(res,503,{error:'Storage unavailable; keep the event locally and retry'}) }
}).listen(3001,'127.0.0.1',()=>console.log('AcuPill API: http://127.0.0.1:3001'))
