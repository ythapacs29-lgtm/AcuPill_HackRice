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
export async function saveInteractionEvent(event) {
  const response = await fetch(`${API_BASE_URL}/api/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event), signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Failed to save interaction: ${response.status}`)
  return (await response.json()).event
}
export function queueInteractionEvent(event) {
  const queue = loadUploadQueue()
  if (!queue.some(item => item.event_id === event.event_id)) saveUploadQueue([...queue, event])
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
