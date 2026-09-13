// Completed-session analysis only. Live gating remains in App.jsx.
export const CORE_METRICS = ['duration_ms', 'max_tilt_degrees', 'average_tilt_degrees',
  'total_motion_score', 'average_motion_score', 'peak_motion_score', 'motion_variability_score', 'sample_count']
const vectorKeys = ['ax', 'ay', 'az']
const vector = v => v && vectorKeys.every(k => typeof v[k] === 'number' && Number.isFinite(v[k]))
const sample = v => vector(v) && Number.isFinite(v.t_ms) && v.t_ms >= 0
const sum = xs => xs.reduce((a,b) => a+b,0)
const mean = xs => xs.length ? sum(xs)/xs.length : 0
export function orientation(current, reference) {
  if (!vector(current) || !vector(reference)) throw new TypeError('Invalid acceleration/reference vector')
  const length = v => Math.sqrt(v.ax*v.ax+v.ay*v.ay+v.az*v.az)
  const a=length(current), b=length(reference)
  if (!a || !b || !Number.isFinite(a*b)) throw new TypeError('Zero or invalid acceleration/reference vector')
  const cosine = vectorKeys.reduce((s,k) => s+current[k]*reference[k],0)/(a*b)
  return {
    tilt: Math.acos(Math.max(-1,Math.min(1,cosine)))*180/Math.PI,
    roll: Math.atan2(current.ay,current.az)*180/Math.PI,
    pitch: Math.atan2(-current.ax,Math.sqrt(current.ay**2+current.az**2))*180/Math.PI,
  }
}
export function analyzeSessionJS(session) {
  const {samples, reference, initial_sample, start_ms, end_ms} = session || {}
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > 10000 || !samples.every(sample)) {
    throw new TypeError('Expected 2–10000 finite session samples')
  }
  if (initial_sample != null && !sample(initial_sample)) throw new TypeError('Invalid boundary sample')
  const start = start_ms ?? samples[0].t_ms, end = end_ms ?? samples.at(-1).t_ms
  if (![start,end].every(Number.isFinite) || start<0 || end<start || samples.some(s=>s.t_ms<start || s.t_ms>end)) {
    throw new TypeError('Invalid session boundaries')
  }
  const angles=samples.map(s=>orientation(s,reference))
  const motions=[], jerks=[]
  let previous=initial_sample
  for (const current of samples) {
    const delta=previous ? vectorKeys.map(k=>current[k]-previous[k]) : [0,0,0]
    motions.push(sum(delta.map(Math.abs)))
    const dt=previous ? (current.t_ms-previous.t_ms)/1000 : 0
    // No division for duplicate or backward clocks. Motion retains legacy deltas.
    if (dt>0) jerks.push(Math.sqrt(sum(delta.map(x=>x*x)))/dt)
    previous=current
  }
  const avg=mean(motions)
  const result={
    duration_ms:end-start, max_tilt_degrees:Math.max(...angles.map(a=>a.tilt)),
    average_tilt_degrees:mean(angles.map(a=>a.tilt)), total_motion_score:sum(motions),
    average_motion_score:avg, peak_motion_score:Math.max(...motions),
    motion_variability_score:Math.sqrt(mean(motions.map(x=>(x-avg)**2))),
    average_jerk:mean(jerks), peak_jerk:Math.max(0,...jerks), sample_count:samples.length,
    tilt_degrees:angles.map(a=>a.tilt), roll_degrees:angles.map(a=>a.roll), pitch_degrees:angles.map(a=>a.pitch),
  }
  if ([...CORE_METRICS,'average_jerk','peak_jerk'].some(k=>!Number.isFinite(result[k]))) throw new TypeError('Nonfinite motion result')
  return result
}

// The provider sends one completed session to the persistent MATLAB worker.
// Absence, validation failure and timeout preserve the original detector metrics.
export async function analyzeSessionWithMatlab(session, legacyMetrics, {analyze, timeoutMs=1500, warn=console.warn}={}) {
  let fallback={...legacyMetrics,average_jerk:null,peak_jerk:null,metrics_source:'js_fallback'}
  try {
    const js=analyzeSessionJS(session)
    fallback={...js,...fallback,average_jerk:js.average_jerk,peak_jerk:js.peak_jerk}
    if (!analyze) { warn('Motion analysis: MATLAB unavailable; retaining JavaScript metrics'); return fallback }
    const controller=new AbortController()
    let timer
    try {
      const result=await Promise.race([
        Promise.resolve().then(()=>analyze(session,{signal:controller.signal})),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Analysis timeout'))},timeoutMs)})
      ])
      for (const k of [...CORE_METRICS,'average_jerk','peak_jerk']) {
        if (!Number.isFinite(result?.[k]) || result[k]<0) throw new TypeError('Invalid MATLAB output')
      }
      // Preserve the established event/history definitions. Reject an engine
      // with different duration, sample boundaries, motion formula, or std norm.
      for (const k of CORE_METRICS) {
        if (Math.abs(result[k]-legacyMetrics[k])>1e-7*Math.max(1,Math.abs(legacyMetrics[k]))) throw new TypeError('MATLAB metric contract mismatch')
      }
      const normalized=Object.fromEntries([...CORE_METRICS,'average_jerk','peak_jerk'].map(k=>[k,result[k]]))
      return {...normalized,metrics_source:'matlab'}
    } finally { clearTimeout(timer); controller.abort() }
  } catch {
    warn('Motion analysis failed validation or timed out; retaining JavaScript metrics')
    return fallback
  }
}
