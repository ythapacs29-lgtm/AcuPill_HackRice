import { analyzeSessionWithMatlab, CORE_METRICS } from './motionAnalysis.js'
const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || ''
const UPLOAD_QUEUE_STORAGE_KEY = 'acupill_event_upload_queue_v1'
function loadUploadQueue() {
  try {
    const saved = window.localStorage.getItem(UPLOAD_QUEUE_STORAGE_KEY)
    const events = saved ? JSON.parse(saved) : []
    return Array.isArray(events) ? events.filter(event => event && typeof event.event_id === 'string') : []
  } catch { return [] }
}
function saveUploadQueue(events) {
  window.localStorage.setItem(UPLOAD_QUEUE_STORAGE_KEY, JSON.stringify(events))
}
async function prepareInteractionEvent(queued) {
  const { __motionSession, ...event } = queued
  if (!__motionSession) return event
  const metrics = await analyzeSessionWithMatlab(__motionSession, event, {
    analyze: async (session, {signal}) => {
      const response = await fetch(`${API_BASE_URL}/api/motion/analyze`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(session), signal,
      })
      if (!response.ok) throw new Error('MATLAB unavailable')
      return response.json()
    },
  })
  for (const key of [...CORE_METRICS, 'average_jerk', 'peak_jerk', 'metrics_source']) event[key] = metrics[key]
  // Persist the final payload BEFORE POST. Retries must reuse identical metrics.
  saveUploadQueue(loadUploadQueue().map(item => item.event_id===event.event_id ? event : item))
  console.info(`Motion analysis: ${event.metrics_source}`)
  window.dispatchEvent(new CustomEvent('acupill-motion-analysis', {detail: {
    event_id:event.event_id, metrics_source:event.metrics_source,
    average_jerk:event.average_jerk, peak_jerk:event.peak_jerk,
  }}))
  return event
}
export async function saveInteractionEvent(queued) {
  const event = await prepareInteractionEvent(queued)
  const response = await fetch(`${API_BASE_URL}/api/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event), signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Failed to save interaction: ${response.status}`)
  return (await response.json()).event
}
export function queueInteractionEvent(event, session) {
  const queue = loadUploadQueue()
  if (!queue.some(item => item.event_id === event.event_id)) saveUploadQueue([...queue, session ? {...event, __motionSession: session} : event])
}
let activeFlush
export function flushInteractionEventQueue() {
  if (activeFlush) return activeFlush
  activeFlush = flushQueue().finally(() => { activeFlush = undefined })
  return activeFlush
}
async function flushQueue() {
  let uploaded = 0
  for (const event of loadUploadQueue()) {
    try {
      await saveInteractionEvent(event)
      // Re-read so interactions queued during the request are preserved.
      saveUploadQueue(loadUploadQueue().filter(item => item.event_id !== event.event_id))
      uploaded += 1
    } catch { /* Keep failed uploads for the next retry. */ }
  }
  return { uploaded, pending: loadUploadQueue().length }
}
export async function getInteractionEvents() {
  const response = await fetch(`${API_BASE_URL}/api/events`, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Failed to load interactions: ${response.status}`)
  const data = await response.json()
  if (!Array.isArray(data.items)) throw new Error('The event response was not recognized.')
  return data.items
}
