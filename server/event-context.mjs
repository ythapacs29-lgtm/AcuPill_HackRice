const metrics = ['duration_ms','max_tilt_degrees','average_tilt_degrees','total_motion_score','average_motion_score','peak_motion_score','motion_variability_score']
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const exact = (x, keys) => object(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x,k))
const uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)
const version = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 100
const iso = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x
export function validEventContext(e) {
 const {baseline:b, percent_changes:p, schedule_match:s} = e
 if(b != null) {
  if(!exact(b,['algorithm_version','event_ids','event_count','means']) || !version(b.algorithm_version)) return false
  if(!Array.isArray(b.event_ids) || b.event_ids.length < 3 || b.event_ids.length > 100 || !b.event_ids.every(uuid) || new Set(b.event_ids).size !== b.event_ids.length || b.event_ids.includes(e.event_id) || b.event_count !== b.event_ids.length) return false
  if(!exact(b.means,metrics) || !metrics.every(k=>Number.isFinite(b.means[k]) && b.means[k]>=0) || b.means.max_tilt_degrees>180 || b.means.average_tilt_degrees>180) return false
 }
 if(p != null) {
  if(b == null || !exact(p,['algorithm_version','values']) || !version(p.algorithm_version) || !exact(p.values,metrics)) return false
  for(const k of metrics) {
   const v=p.values[k], base=b.means[k]
   if(base===0) {if(v!==null) return false}
   else {const expected=(e[k]-base)/base*100;if(!Number.isFinite(v)||Math.abs(v-expected)>0.000001*Math.max(1,Math.abs(expected))) return false}
  }
 }
 if(s != null) {
  if(!exact(s,['schedule_id','scheduled_at','status','algorithm_version']) || !uuid(s.schedule_id) || !iso(s.scheduled_at) || !['recorded','late'].includes(s.status) || !version(s.algorithm_version)) return false
 }
 return true
}
export {metrics}
