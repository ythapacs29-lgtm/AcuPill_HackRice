import pg from 'pg'
const u = new URL(process.env.DATABASE_URL)
u.searchParams.set('sslmode', 'verify-full')
const c = new pg.Client({connectionString:u.toString(), connectionTimeoutMillis:10000, query_timeout:10000})
try {
  await c.connect()
  const result=await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('interaction_events','medication_schedules','patient_checkins','major_changes') ORDER BY table_name`)
  const hypertable=await c.query("SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name='interaction_events'")
  if(result.rowCount!==4 || hypertable.rowCount!==1) throw Object.assign(new Error(),{code:'SCHEMA_INCOMPLETE'})
  console.log('TLS connection verified; four tables and interaction hypertable verified.')
} catch(error) {
  console.error('Database check failed:', error.code || 'CONNECTION_FAILED')
  process.exitCode=1
} finally {await c.end()}
