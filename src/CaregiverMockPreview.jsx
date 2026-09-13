import { getInteractionEvents } from './services/acupillApi.js'
import {
  adaptCaregiverEvents,
  mockCaregiverEvents,
} from './caregiverAdapter.js'
import { useCallback, useEffect, useState } from 'react'

const patientId = '5e22c7c9-b8d8-4076-814f-87f59d42ce4a'

const numeric = (value, digits = 2) =>
  value === null ? 'Unavailable' : value.toFixed(digits)

const percent = value =>
  value === null
    ? 'Unavailable'
    : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`

const date = value =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Chicago',
  }).format(new Date(value))

export default function CaregiverMockPreview() {
  const [events, setEvents] = useState([])
  const [source, setSource] = useState('Loading')
  const [message, setMessage] = useState('Loading local event history…')

  const loadLiveEvents = useCallback(async () => {
    setSource('Loading')
    setMessage('Loading local event history…')

    try {
      const rows = await getInteractionEvents()
      const adapted = adaptCaregiverEvents(rows, patientId)
      setEvents(adapted)
      setSource('Live local API')
      setMessage(
        adapted.length
          ? 'Showing events returned by your local API.'
          : 'No events have been recorded for this local demo patient yet.'
      )
    } catch (error) {
      setEvents([])
      setSource('Offline')
      setMessage(
        `${error.message}. The verified synthetic demo remains available below.`
      )
    }
  }, [])

  useEffect(() => {
    loadLiveEvents()
  }, [loadLiveEvents])

  const showSyntheticDemo = () => {
    setEvents(adaptCaregiverEvents(mockCaregiverEvents, patientId))
    setSource('Verified synthetic demo')
    setMessage(
      'Showing five synthetic API events. They are not real patient or sensor data.'
    )
  }

  return (
    <section aria-labelledby="caregiver-mock-title">
      <p className="eyebrow">Caregiver / clinician</p>

      <h2
        id="caregiver-mock-title"
        className="caregiver-title"
      >
        Patient interaction preview
      </h2>

      <p className="patient-intro">
        Event history for the configured local demo patient.
        Times are shown in America/Chicago.
      </p>

      <p className="demo-note">
        {message}
      </p>

      <button
        type="button"
        className="secondary-button"
        onClick={loadLiveEvents}
      >
        Refresh live events
      </button>{' '}

      <button
        type="button"
        className="secondary-button"
        onClick={showSyntheticDemo}
      >
        Show verified synthetic demo
      </button>

      <section
        className="section-block"
        aria-label="Mock interaction summary"
      >
        <div className="routine-summary-grid">
          <div className="metric-card">
            <p className="metric-label">Interactions</p>
            <p className="metric-value">{events.length}</p>
          </div>

          <div className="metric-card">
            <p className="metric-label">Latest interaction</p>
            <p>
              {events.length
                ? date(events[0].recordedAt)
                : 'No interactions'}
            </p>
          </div>

          <div className="metric-card">
            <p className="metric-label">Data source</p>
            <p className="metric-value">{source}</p>
          </div>
        </div>
      </section>

      <section
        className="section-block"
        aria-label="Mock interaction history"
      >
        <div className="section-heading">
          <h2>Interaction history</h2>
        </div>

        {events.length ? (
        <div className="table-wrap">
          <table>
            <caption
              style={{
                textAlign: 'left',
                marginBottom: 12,
              }}
            >
              Context is shown when the API supplies it. Unavailable
              values are not treated as zero.
            </caption>

            <thead>
              <tr>
                <th scope="col">Recorded time</th>
                <th scope="col">Duration (seconds)</th>
                <th scope="col">Total motion</th>
                <th scope="col">Motion variability</th>
                <th scope="col">Baseline events</th>
                <th scope="col">Duration change</th>
                <th scope="col">Motion change</th>
                <th scope="col">Variability change</th>
                <th scope="col">Schedule match</th>
              </tr>
            </thead>

            <tbody>
              {events.map(event => (
                <tr key={event.id}>
                  <td>{date(event.recordedAt)}</td>
                  <td>
                    {numeric(
                      event.duration === null
                        ? null
                        : event.duration / 1000
                    )}
                  </td>
                  <td>{numeric(event.motion)}</td>
                  <td>{numeric(event.variability, 3)}</td>
                  <td>
                    {event.baselineEventCount === null
                      ? 'Unavailable'
                      : event.baselineEventCount}
                  </td>
                  <td>{percent(event.durationChange)}</td>
                  <td>{percent(event.motionChange)}</td>
                  <td>{percent(event.variabilityChange)}</td>
                  <td>
                    {event.scheduleStatus || 'Unavailable'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : (
          <p className="empty-card">No interaction events to display.</p>
        )}

        <p className="schedule-note">
          Bottle interactions do not confirm medication ingestion.
          Unavailable baseline values are not treated as zero.
          Certificate verification remains disabled for this local
          development demo.
        </p>
      </section>
    </section>
  )
}
