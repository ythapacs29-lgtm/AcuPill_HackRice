import CaregiverMockPreview from './CaregiverMockPreview.jsx'
import { useEffect, useRef, useState } from 'react'
import './App.css'
import {
  flushInteractionEventQueue,
  queueInteractionEvent,
} from './services/acupillApi.js'

/* ============================================================
   ACUPILL DETECTION SETTINGS
   ============================================================ */

const TILT_THRESHOLD_DEGREES = 30
const RETURN_THRESHOLD_DEGREES = 25
const REST_THRESHOLD_DEGREES = 15
const MOTION_THRESHOLD = 0.12

const MIN_EVENT_DURATION_MS = 1000
const MAX_EVENT_DURATION_MS = 15000
const EVENT_COOLDOWN_MS = 4000

/* ============================================================
   MAJOR CHANGE SETTINGS

   An individual interaction is "outside baseline" if ANY of:

   duration difference > 35%
   total motion difference > 30%
   movement variability difference > 25%

   We DO NOT surface one unusual interaction.

   3 of last 5 comparable valid interactions
   = create Major Change marker
   ============================================================ */

const DURATION_DEVIATION_THRESHOLD = 35
const MOTION_DEVIATION_THRESHOLD = 30
const VARIABILITY_DEVIATION_THRESHOLD = 25

const MIN_BASELINE_EVENTS = 4
const MAJOR_CHANGE_WINDOW_SIZE = 5
const MAJOR_CHANGE_REQUIRED_COUNT = 3

/* ============================================================
   STORAGE
   ============================================================ */

const EVENT_STORAGE_KEY =
  'acupill_event_history_v1'

const SCHEDULE_STORAGE_KEY =
  'acupill_schedule_v1'

const MAJOR_CHANGE_STORAGE_KEY =
  'acupill_major_changes_v1'

const CHECKIN_STORAGE_KEY =
  'acupill_checkins_v1'

const API_PATIENT_ID =
  '5e22c7c9-b8d8-4076-814f-87f59d42ce4a'

const API_DEVICE_ID =
  '70064ad6-90ac-430a-94e5-84e0ddeb2c4d'

const DETECTOR_VERSION =
  'm10-v1'

/* ============================================================
   SCHEDULE MATCHING
   ============================================================ */

const EARLY_WINDOW_MINUTES = 30
const RECORDED_WINDOW_MINUTES = 60
const LATE_WINDOW_MINUTES = 180

const DEFAULT_SCHEDULE = [
  {
    id: 1,
    label: 'Morning medication',
    time: '08:00',
    enabled: true,
  },
  {
    id: 2,
    label: 'Evening medication',
    time: '20:00',
    enabled: true,
  },
]

const ROTATING_TERMS = [
  'routine',
  'movement',
  'care',
  'independence',
]

/* ============================================================
   SENSOR PARSER
   ============================================================ */

function parseSensorLine(line) {
  const parts = line.trim().split(',')

  if (parts.length !== 5) {
    return null
  }

  const data = {
    t_ms: Number(parts[0]),
    touch: Number(parts[1]),
    ax: Number(parts[2]),
    ay: Number(parts[3]),
    az: Number(parts[4]),
  }

  if (
    Number.isNaN(data.t_ms) ||
    Number.isNaN(data.touch) ||
    Number.isNaN(data.ax) ||
    Number.isNaN(data.ay) ||
    Number.isNaN(data.az)
  ) {
    return null
  }

  return data
}

/* ============================================================
   MATH
   ============================================================ */

function vectorMagnitude(vector) {
  return Math.sqrt(
    vector.ax * vector.ax +
      vector.ay * vector.ay +
      vector.az * vector.az
  )
}

function angleBetweenVectorsDegrees(a, b) {
  const dot =
    a.ax * b.ax +
    a.ay * b.ay +
    a.az * b.az

  const magA = vectorMagnitude(a)
  const magB = vectorMagnitude(b)

  if (magA === 0 || magB === 0) {
    return 0
  }

  let cosine = dot / (magA * magB)

  cosine = Math.max(
    -1,
    Math.min(1, cosine)
  )

  return (
    Math.acos(cosine) *
    (180 / Math.PI)
  )
}

function averageSamples(samples) {
  if (samples.length === 0) {
    return null
  }

  const total = samples.reduce(
    (sum, sample) => ({
      ax: sum.ax + sample.ax,
      ay: sum.ay + sample.ay,
      az: sum.az + sample.az,
    }),
    {
      ax: 0,
      ay: 0,
      az: 0,
    }
  )

  return {
    ax: total.ax / samples.length,
    ay: total.ay / samples.length,
    az: total.az / samples.length,
  }
}

function average(numbers) {
  if (numbers.length === 0) {
    return 0
  }

  return (
    numbers.reduce(
      (total, value) =>
        total + value,
      0
    ) / numbers.length
  )
}

function sum(numbers) {
  return numbers.reduce(
    (total, value) =>
      total + value,
    0
  )
}

function standardDeviation(numbers) {
  if (numbers.length === 0) {
    return 0
  }

  const avg = average(numbers)

  const variance =
    numbers.reduce(
      (total, value) => {
        const difference =
          value - avg

        return (
          total +
          difference * difference
        )
      },
      0
    ) / numbers.length

  return Math.sqrt(variance)
}

function percentChange(
  latestValue,
  baselineValue
) {
  if (
    !Number.isFinite(latestValue) ||
    !Number.isFinite(baselineValue) ||
    baselineValue === 0
  ) {
    return 0
  }

  return (
    ((latestValue -
      baselineValue) /
      baselineValue) *
    100
  )
}

/* ============================================================
   STORAGE HELPERS
   ============================================================ */

function loadArrayFromStorage(
  key,
  fallback = []
) {
  try {
    const saved =
      localStorage.getItem(key)

    if (!saved) {
      return fallback
    }

    const parsed =
      JSON.parse(saved)

    return Array.isArray(parsed)
      ? parsed
      : fallback
  } catch (error) {
    console.error(
      `Could not load ${key}:`,
      error
    )

    return fallback
  }
}

function saveArrayToStorage(
  key,
  value
) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(value)
    )
  } catch (error) {
    console.error(
      `Could not save ${key}:`,
      error
    )
  }
}

function loadSavedEvents() {
  return loadArrayFromStorage(
    EVENT_STORAGE_KEY,
    []
  )
}

function loadMajorChanges() {
  return loadArrayFromStorage(
    MAJOR_CHANGE_STORAGE_KEY,
    []
  )
}

function loadCheckIns() {
  return loadArrayFromStorage(
    CHECKIN_STORAGE_KEY,
    []
  )
}

function loadSchedule() {
  const loaded =
    loadArrayFromStorage(
      SCHEDULE_STORAGE_KEY,
      DEFAULT_SCHEDULE
    )

  if (loaded.length === 0) {
    return DEFAULT_SCHEDULE
  }

  return loaded
}

/* ============================================================
   FORMATTING
   ============================================================ */

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '—'
  }

  const sign =
    value > 0 ? '+' : ''

  return `${sign}${value.toFixed(1)}%`
}

function formatNumber(
  value,
  digits = 3
) {
  if (!Number.isFinite(value)) {
    return '—'
  }

  return value.toFixed(digits)
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return '—'
  }

  return `${Math.round(value)} ms`
}

function formatScheduleTime(time) {
  if (!time) {
    return '—'
  }

  const [
    hoursString,
    minutesString,
  ] = time.split(':')

  let hours =
    Number(hoursString)

  const minutes =
    Number(minutesString)

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return time
  }

  const period =
    hours >= 12
      ? 'PM'
      : 'AM'

  hours %= 12

  if (hours === 0) {
    hours = 12
  }

  return `${hours}:${String(
    minutes
  ).padStart(2, '0')} ${period}`
}

function formatLongDate(date) {
  return date.toLocaleDateString(
    undefined,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }
  )
}

function formatDayName(date) {
  return date.toLocaleDateString(
    undefined,
    {
      weekday: 'short',
    }
  )
}

function formatShortDate(date) {
  return date.toLocaleDateString(
    undefined,
    {
      month: 'short',
      day: 'numeric',
    }
  )
}

/* ============================================================
   DATES
   ============================================================ */

function getScheduleDate(
  baseDate,
  time
) {
  const [hours, minutes] =
    time
      .split(':')
      .map(Number)

  const date =
    new Date(baseDate)

  date.setHours(
    hours,
    minutes,
    0,
    0
  )

  return date
}

function startOfDay(date) {
  const result =
    new Date(date)

  result.setHours(
    0,
    0,
    0,
    0
  )

  return result
}

function addDays(
  date,
  numberOfDays
) {
  const result =
    new Date(date)

  result.setDate(
    result.getDate() +
      numberOfDays
  )

  return result
}

function isSameDay(a, b) {
  return (
    a.getFullYear() ===
      b.getFullYear() &&
    a.getMonth() ===
      b.getMonth() &&
    a.getDate() ===
      b.getDate()
  )
}

function getEventDate(event) {
  if (!event.recordedAtISO) {
    return null
  }

  const date =
    new Date(
      event.recordedAtISO
    )

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null
  }

  return date
}

function createApiEventId() {
  return crypto.randomUUID()
}

/* ============================================================
   BASELINE
   ============================================================ */

function calculateBaseline(events) {
  if (
    !events ||
    events.length === 0
  ) {
    return null
  }

  return {
    count: events.length,

    durationMs: average(
      events.map(
        (event) =>
          event.durationMs || 0
      )
    ),

    maxTiltAngle: average(
      events.map(
        (event) =>
          event.maxTiltAngle || 0
      )
    ),

    totalMotion: average(
      events.map(
        (event) =>
          event.totalMotion || 0
      )
    ),

    averageMotion: average(
      events.map(
        (event) =>
          event.averageMotion || 0
      )
    ),

    peakMotion: average(
      events.map(
        (event) =>
          event.peakMotion || 0
      )
    ),

    motionVariability: average(
      events.map(
        (event) =>
          event.motionVariability || 0
      )
    ),
  }
}

/* ============================================================
   EVENT BASELINE COMPARISON

   IMPORTANT:
   This receives PRIOR events only.
   The new event does not participate in
   the baseline used to evaluate itself.
   ============================================================ */

function calculateEventBaselineComparison(
  telemetry,
  priorEvents
) {
  const baseline =
    calculateBaseline(
      priorEvents
    )

  if (
    !baseline ||
    baseline.count <
      MIN_BASELINE_EVENTS
  ) {
    return {
      hasBaseline: false,

      outsideBaseline: false,

      durationPct: null,
      totalMotionPct: null,
      variabilityPct: null,

      durationOutside: false,
      motionOutside: false,
      variabilityOutside: false,

      baselineEventCount:
        baseline?.count || 0,
    }
  }

  const durationPct =
    percentChange(
      telemetry.durationMs,
      baseline.durationMs
    )

  const totalMotionPct =
    percentChange(
      telemetry.totalMotion,
      baseline.totalMotion
    )

  const variabilityPct =
    percentChange(
      telemetry.motionVariability,
      baseline.motionVariability
    )

  const durationOutside =
    Math.abs(durationPct) >
    DURATION_DEVIATION_THRESHOLD

  const motionOutside =
    Math.abs(totalMotionPct) >
    MOTION_DEVIATION_THRESHOLD

  const variabilityOutside =
    Math.abs(variabilityPct) >
    VARIABILITY_DEVIATION_THRESHOLD

  return {
    hasBaseline: true,

    outsideBaseline:
      durationOutside ||
      motionOutside ||
      variabilityOutside,

    durationPct,
    totalMotionPct,
    variabilityPct,

    durationOutside,
    motionOutside,
    variabilityOutside,

    baselineEventCount:
      baseline.count,

    baselineSnapshot: {
      durationMs:
        baseline.durationMs,

      totalMotion:
        baseline.totalMotion,

      motionVariability:
        baseline.motionVariability,

      maxTiltAngle:
        baseline.maxTiltAngle,

      averageMotion:
        baseline.averageMotion,

      peakMotion:
        baseline.peakMotion,
    },
  }
}

/* ============================================================
   3 OF LAST 5 PERSISTENCE LOGIC
   ============================================================ */

function getRecentDeviationSummary(
  events
) {
  const comparableEvents =
    events
      .filter(
        (event) =>
          event
            .baselineComparison
            ?.hasBaseline
      )
      .slice(
        0,
        MAJOR_CHANGE_WINDOW_SIZE
      )

  const unusualEvents =
    comparableEvents.filter(
      (event) =>
        event
          .baselineComparison
          ?.outsideBaseline
    )

  const durationCount =
    comparableEvents.filter(
      (event) =>
        event
          .baselineComparison
          ?.durationOutside
    ).length

  const motionCount =
    comparableEvents.filter(
      (event) =>
        event
          .baselineComparison
          ?.motionOutside
    ).length

  const variabilityCount =
    comparableEvents.filter(
      (event) =>
        event
          .baselineComparison
          ?.variabilityOutside
    ).length

  return {
    comparableCount:
      comparableEvents.length,

    unusualCount:
      unusualEvents.length,

    durationCount,
    motionCount,
    variabilityCount,

    comparableEvents,
    unusualEvents,

    qualifies:
      comparableEvents.length ===
        MAJOR_CHANGE_WINDOW_SIZE &&
      unusualEvents.length >=
        MAJOR_CHANGE_REQUIRED_COUNT,
  }
}

function createMajorChangeMarker(
  summary,
  triggerEvent
) {
  const unusualComparisons =
    summary.unusualEvents.map(
      (event) =>
        event.baselineComparison
    )

  return {
    id:
      `major-${triggerEvent.id}-${Date.now()}`,

    createdAtISO:
      triggerEvent.recordedAtISO,

    recordedDate:
      triggerEvent.recordedDate,

    clockTime:
      triggerEvent.clockTime,

    triggerEventId:
      triggerEvent.id,

    unusualCount:
      summary.unusualCount,

    windowSize:
      MAJOR_CHANGE_WINDOW_SIZE,

    eventIds:
      summary.comparableEvents.map(
        (event) => event.id
      ),

    unusualEventIds:
      summary.unusualEvents.map(
        (event) => event.id
      ),

    durationCount:
      summary.durationCount,

    motionCount:
      summary.motionCount,

    variabilityCount:
      summary.variabilityCount,

    averageDurationPct:
      average(
        unusualComparisons
          .map(
            (comparison) =>
              comparison.durationPct
          )
          .filter(
            Number.isFinite
          )
      ),

    averageTotalMotionPct:
      average(
        unusualComparisons
          .map(
            (comparison) =>
              comparison.totalMotionPct
          )
          .filter(
            Number.isFinite
          )
      ),

    averageVariabilityPct:
      average(
        unusualComparisons
          .map(
            (comparison) =>
              comparison.variabilityPct
          )
          .filter(
            Number.isFinite
          )
      ),
  }
}

/* ============================================================
   SCHEDULE
   ============================================================ */

function getNextMedication(
  schedule,
  now
) {
  const enabledSchedule =
    schedule
      .filter(
        (item) => item.enabled
      )
      .sort(
        (a, b) =>
          a.time.localeCompare(
            b.time
          )
      )

  if (
    enabledSchedule.length === 0
  ) {
    return null
  }

  for (
    const item of
    enabledSchedule
  ) {
    const scheduledDate =
      getScheduleDate(
        now,
        item.time
      )

    if (
      scheduledDate > now
    ) {
      return {
        ...item,
        scheduledDate,
        isTomorrow: false,
      }
    }
  }

  const firstTomorrow =
    enabledSchedule[0]

  const tomorrow =
    addDays(now, 1)

  return {
    ...firstTomorrow,

    scheduledDate:
      getScheduleDate(
        tomorrow,
        firstTomorrow.time
      ),

    isTomorrow: true,
  }
}

function buildScheduleStatusesForDate(
  schedule,
  events,
  dayDate,
  now
) {
  const activeSchedule =
    schedule
      .filter(
        (item) => item.enabled
      )
      .sort(
        (a, b) =>
          a.time.localeCompare(
            b.time
          )
      )

  const usableEvents =
    events
      .map((event) => ({
        event,
        date:
          getEventDate(event),
      }))
      .filter(
        (entry) =>
          entry.date
      )

  const usedEventIds =
    new Set()

  const todayStart =
    startOfDay(now)

  const requestedDayStart =
    startOfDay(dayDate)

  const requestedDayIsPast =
    requestedDayStart.getTime() <
    todayStart.getTime()

  const requestedDayIsFuture =
    requestedDayStart.getTime() >
    todayStart.getTime()

  return activeSchedule.map(
    (item) => {
      const scheduledDate =
        getScheduleDate(
          dayDate,
          item.time
        )

      const earlyStart =
        new Date(
          scheduledDate.getTime() -
            EARLY_WINDOW_MINUTES *
              60 *
              1000
        )

      const recordedEnd =
        new Date(
          scheduledDate.getTime() +
            RECORDED_WINDOW_MINUTES *
              60 *
              1000
        )

      const lateEnd =
        new Date(
          scheduledDate.getTime() +
            LATE_WINDOW_MINUTES *
              60 *
              1000
        )

      const matchingEvents =
        usableEvents
          .filter(
            ({
              event,
              date,
            }) =>
              !usedEventIds.has(
                event.id
              ) &&
              date >= earlyStart &&
              date <= lateEnd
          )
          .sort(
            (a, b) =>
              Math.abs(
                a.date.getTime() -
                  scheduledDate.getTime()
              ) -
              Math.abs(
                b.date.getTime() -
                  scheduledDate.getTime()
              )
          )

      const matched =
        matchingEvents[0]

      if (matched) {
        usedEventIds.add(
          matched.event.id
        )

        if (
          matched.date <=
          recordedEnd
        ) {
          return {
            ...item,

            scheduledDate,

            status:
              'recorded',

            statusLabel:
              'Recorded',

            matchedEvent:
              matched.event,

            matchedDate:
              matched.date,
          }
        }

        return {
          ...item,

          scheduledDate,

          status:
            'late',

          statusLabel:
            'Recorded late',

          matchedEvent:
            matched.event,

          matchedDate:
            matched.date,
        }
      }

      if (
        requestedDayIsFuture
      ) {
        return {
          ...item,

          scheduledDate,

          status:
            'upcoming',

          statusLabel:
            'Upcoming',

          matchedEvent: null,
        }
      }

      if (
        requestedDayIsPast
      ) {
        return {
          ...item,

          scheduledDate,

          status:
            'missing',

          statusLabel:
            'No interaction recorded',

          matchedEvent: null,
        }
      }

      if (
        now < scheduledDate
      ) {
        return {
          ...item,

          scheduledDate,

          status:
            'upcoming',

          statusLabel:
            'Upcoming',

          matchedEvent: null,
        }
      }

      if (
        now <= lateEnd
      ) {
        return {
          ...item,

          scheduledDate,

          status:
            'waiting',

          statusLabel:
            'No interaction recorded yet',

          matchedEvent: null,
        }
      }

      return {
        ...item,

        scheduledDate,

        status:
          'missing',

        statusLabel:
          'No interaction recorded',

        matchedEvent: null,
      }
    }
  )
}

function buildWeeklyRoutine(
  schedule,
  events,
  now
) {
  const days = []

  for (
    let offset = 6;
    offset >= 0;
    offset -= 1
  ) {
    const date =
      addDays(
        startOfDay(now),
        -offset
      )

    const statuses =
      buildScheduleStatusesForDate(
        schedule,
        events,
        date,
        now
      )

    const recorded =
      statuses.filter(
        (item) =>
          item.status ===
          'recorded'
      ).length

    const late =
      statuses.filter(
        (item) =>
          item.status ===
          'late'
      ).length

    const missing =
      statuses.filter(
        (item) =>
          item.status ===
          'missing'
      ).length

    const waiting =
      statuses.filter(
        (item) =>
          item.status ===
            'waiting' ||
          item.status ===
            'upcoming'
      ).length

    days.push({
      date,
      statuses,

      scheduled:
        statuses.length,

      recorded,
      late,
      missing,
      waiting,

      completed:
        recorded + late,
    })
  }

  return days
}

/* ============================================================
   TREND HELPERS
   ============================================================ */

function Sparkline({ values }) {
  const usable =
    values.filter(
      Number.isFinite
    )

  if (usable.length < 2) {
    return (
      <p className="tiny-text">
        More events needed.
      </p>
    )
  }

  const width = 260
  const height = 70
  const padding = 6

  const min =
    Math.min(...usable)

  const max =
    Math.max(...usable)

  const range =
    max - min || 1

  const points =
    usable
      .map(
        (value, index) => {
          const x =
            padding +
            (index /
              (usable.length - 1)) *
              (width -
                padding * 2)

          const y =
            height -
            padding -
            ((value - min) /
              range) *
              (height -
                padding * 2)

          return `${x},${y}`
        }
      )
      .join(' ')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{
        width: '100%',
        maxWidth: '280px',
        height: '70px',
        display: 'block',
        marginTop: '10px',
        overflow: 'visible',
      }}
      aria-hidden="true"
    >
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        stroke="currentColor"
        opacity="0.12"
      />

      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TrendCard({
  label,
  values,
  formatter,
}) {
  const latest =
    values.length > 0
      ? values[
          values.length - 1
        ]
      : null

  return (
    <div className="metric-card">
      <p className="metric-label">
        {label}
      </p>

      <p className="metric-value">
        {latest === null
          ? '—'
          : formatter(latest)}
      </p>

      <Sparkline
        values={values}
      />

      <p className="metric-subtext">
        Oldest → newest
      </p>
    </div>
  )
}

/* ============================================================
   LOGO
   ============================================================ */

function LogoMark() {
  return (
    <div className="logo-lockup">
      <div
        className="logo-icon"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 64 64"
          width="46"
          height="46"
        >
          <rect
            x="10"
            y="18"
            width="44"
            height="28"
            rx="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />

          <path
            d="M32 18 L32 46"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />

          <path
            d="M16 32 H23 L27 26 L34 38 L39 30 H48"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div>
        <p className="eyebrow">
          Medication support
          between appointments
        </p>

        <h1 className="brand-title">
          <span>Acu</span>

          <span className="brand-accent">
            Pill
          </span>
        </h1>
      </div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  subtext,
}) {
  return (
    <div className="metric-card">
      <p className="metric-label">
        {label}
      </p>

      <p
        key={String(value)}
        className="metric-value tick"
      >
        {value}
      </p>

      {subtext ? (
        <p className="metric-subtext">
          {subtext}
        </p>
      ) : null}
    </div>
  )
}

/* ============================================================
   MAIN APP
   ============================================================ */

function App() {
  const [motionAnalysis, setMotionAnalysis] = useState(null)
  useEffect(() => {
    const receive = event => setMotionAnalysis(event.detail)
    window.addEventListener('acupill-motion-analysis', receive)
    return () => window.removeEventListener('acupill-motion-analysis', receive)
  }, [])

  /* =========================================================
     LOGIN
     ========================================================= */

  const [
    session,
    setSession,
  ] = useState(null)

  const [
    loginRole,
    setLoginRole,
  ] = useState('patient')

  const [
    loginEmail,
    setLoginEmail,
  ] = useState('')

  const [
    loginPassword,
    setLoginPassword,
  ] = useState('')

  /* =========================================================
     SAVED DATA
     ========================================================= */

  const [
    schedule,
    setSchedule,
  ] = useState(
    () => loadSchedule()
  )

  const [
    eventLog,
    setEventLog,
  ] = useState(
    () => loadSavedEvents()
  )

  const [
    majorChanges,
    setMajorChanges,
  ] = useState(
    () => loadMajorChanges()
  )

  const [
    checkIns,
    setCheckIns,
  ] = useState(
    () => loadCheckIns()
  )

  const [
    now,
    setNow,
  ] = useState(
    () => new Date()
  )

  /* =========================================================
     DEVICE
     ========================================================= */

  const [
    connected,
    setConnected,
  ] = useState(false)

  const [
    lastLine,
    setLastLine,
  ] = useState(
    'No data yet'
  )

  const [
    sensorData,
    setSensorData,
  ] = useState({
    t_ms: 0,
    touch: 0,
    ax: 0,
    ay: 0,
    az: 0,
  })

  const [
    movementState,
    setMovementState,
  ] = useState('IDLE')

  const [
    restBaseline,
    setRestBaseline,
  ] = useState({
    ax: 0,
    ay: 1,
    az: 0,
  })

  const [
    debug,
    setDebug,
  ] = useState({
    tiltAngleDegrees: 0,
    motionAmount: 0,
    isTilted: false,
    isMoving: false,
    isAtRest: false,
    cooldownActive: false,
  })

  const [
    stateHistory,
    setStateHistory,
  ] = useState([])

  const [
    rejectionLog,
    setRejectionLog,
  ] = useState([])

  const [
    rotatingTermIndex,
    setRotatingTermIndex,
  ] = useState(0)

  /* =========================================================
     REFS
     ========================================================= */

  const eventLogRef =
    useRef(eventLog)

  const majorChangesRef =
    useRef(majorChanges)

  const initialDeviationSummary =
    getRecentDeviationSummary(
      eventLog
    )

  const majorChangeActiveRef =
    useRef(
      initialDeviationSummary.qualifies
    )

  const restBaselineRef =
    useRef({
      ax: 0,
      ay: 1,
      az: 0,
    })

  const recentSamplesRef =
    useRef([])

  const previousDataRef =
    useRef(null)

  const movementStateRef =
    useRef('IDLE')

  const stateStartedAtRef =
    useRef(0)

  const handlingCountRef =
    useRef(0)

  const tiltCountRef =
    useRef(0)

  const returnCountRef =
    useRef(0)

  const idleCountRef =
    useRef(0)

  const currentInteractionRef =
    useRef(null)

  const eventAlreadyDecidedRef =
    useRef(false)

  const uploadFlushActiveRef =
    useRef(false)

  const eventIdRef =
    useRef(
      eventLog.length > 0
        ? Math.max(
            ...eventLog.map(
              (event) =>
                Number(
                  event.id
                ) || 0
            )
          ) + 1
        : 1
    )

  const rejectionIdRef =
    useRef(1)

  const lastEventTimeRef =
    useRef(-999999)

  /* =========================================================
     PERSISTENCE
     ========================================================= */

  async function flushPendingEventUploads() {
    if (uploadFlushActiveRef.current) {
      return
    }

    uploadFlushActiveRef.current = true

    try {
      await flushInteractionEventQueue()
    } finally {
      uploadFlushActiveRef.current = false
    }
  }

  useEffect(() => {
    void flushPendingEventUploads()
    const retry = () => { void flushPendingEventUploads() }
    const timer = window.setInterval(retry, 15000)
    window.addEventListener('online', retry)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', retry)
    }
  }, [])

  useEffect(() => {
    eventLogRef.current =
      eventLog

    saveArrayToStorage(
      EVENT_STORAGE_KEY,
      eventLog
    )
  }, [eventLog])

  useEffect(() => {
    majorChangesRef.current =
      majorChanges

    saveArrayToStorage(
      MAJOR_CHANGE_STORAGE_KEY,
      majorChanges
    )
  }, [majorChanges])

  useEffect(() => {
    saveArrayToStorage(
      CHECKIN_STORAGE_KEY,
      checkIns
    )
  }, [checkIns])

  useEffect(() => {
    saveArrayToStorage(
      SCHEDULE_STORAGE_KEY,
      schedule
    )
  }, [schedule])

  useEffect(() => {
    const interval =
      setInterval(() => {
        setRotatingTermIndex(
          (previous) =>
            (previous + 1) %
            ROTATING_TERMS.length
        )
      }, 2300)

    return () =>
      clearInterval(interval)
  }, [])

  useEffect(() => {
    const interval =
      setInterval(() => {
        setNow(
          new Date()
        )
      }, 30000)

    return () =>
      clearInterval(interval)
  }, [])

  /* =========================================================
     SCHEDULE DATA
     ========================================================= */

  const nextMedication =
    getNextMedication(
      schedule,
      now
    )

  const todayRoutine =
    buildScheduleStatusesForDate(
      schedule,
      eventLog,
      now,
      now
    )

  const weeklyRoutine =
    buildWeeklyRoutine(
      schedule,
      eventLog,
      now
    )

  const weeklyTotals =
    weeklyRoutine.reduce(
      (totals, day) => ({
        scheduled:
          totals.scheduled +
          day.scheduled,

        recorded:
          totals.recorded +
          day.recorded,

        late:
          totals.late +
          day.late,

        missing:
          totals.missing +
          day.missing,

        pending:
          totals.pending +
          day.waiting,
      }),
      {
        scheduled: 0,
        recorded: 0,
        late: 0,
        missing: 0,
        pending: 0,
      }
    )

  const todayCompleted =
    todayRoutine.filter(
      (item) =>
        item.status ===
          'recorded' ||
        item.status ===
          'late'
    ).length

  function updateScheduleItem(
    id,
    field,
    value
  ) {
    setSchedule(
      (oldSchedule) =>
        oldSchedule.map(
          (item) =>
            item.id === id
              ? {
                  ...item,
                  [field]: value,
                }
              : item
        )
    )
  }

  /* =========================================================
     CURRENT BASELINE DISPLAY
     ========================================================= */

  const latestEvent =
    eventLog[0] || null

  const baselineEvents =
    eventLog.slice(1)

  const baseline =
    calculateBaseline(
      baselineEvents
    )

  let durationChange = 0
  let motionChange = 0
  let variabilityChange = 0

  let baselineInsight =
    'Collect more valid interactions to build a personal baseline.'

  let insightTone =
    'neutral'

  if (
    latestEvent &&
    baseline &&
    baseline.count >= 3
  ) {
    durationChange =
      percentChange(
        latestEvent.durationMs,
        baseline.durationMs
      )

    motionChange =
      percentChange(
        latestEvent.totalMotion,
        baseline.totalMotion
      )

    variabilityChange =
      percentChange(
        latestEvent.motionVariability,
        baseline.motionVariability
      )

    if (
      Math.abs(
        durationChange
      ) >
        DURATION_DEVIATION_THRESHOLD ||
      Math.abs(
        motionChange
      ) >
        MOTION_DEVIATION_THRESHOLD ||
      Math.abs(
        variabilityChange
      ) >
        VARIABILITY_DEVIATION_THRESHOLD
    ) {
      baselineInsight =
        'Latest interaction differed from the recent personal baseline.'

      insightTone =
        'warning'
    } else {
      baselineInsight =
        'Latest interaction looks close to the recent personal baseline.'

      insightTone =
        'good'
    }
  }

  /* =========================================================
     REPEATED DEVIATION
     ========================================================= */

  const recentDeviationSummary =
    getRecentDeviationSummary(
      eventLog
    )

  let repeatedDeviationText =
    'Building comparable interaction history.'

  if (
    recentDeviationSummary
      .comparableCount ===
    MAJOR_CHANGE_WINDOW_SIZE
  ) {
    repeatedDeviationText =
      `${recentDeviationSummary.unusualCount} of last ${MAJOR_CHANGE_WINDOW_SIZE} interactions outside baseline`
  }

  /* =========================================================
     PATIENT MOVEMENT LANGUAGE

     Patient is NOT shown raw thresholds.
     ========================================================= */

  let patientMovementStatus =
    'Building your recent movement pattern.'

  if (
    recentDeviationSummary
      .comparableCount ===
    MAJOR_CHANGE_WINDOW_SIZE
  ) {
    if (
      recentDeviationSummary.qualifies
    ) {
      patientMovementStatus =
        'Your recent medication-handling pattern has been a little different from usual.'
    } else {
      patientMovementStatus =
        'Your recent medication-handling pattern looks similar to your usual routine.'
    }
  }

  /* =========================================================
     CAREGIVER "WHAT CHANGED?"
     ========================================================= */

  function buildWhatChangedText() {
    const summary =
      recentDeviationSummary

    if (
      summary.comparableCount <
      MAJOR_CHANGE_WINDOW_SIZE
    ) {
      return (
        `AcuPill needs ${MAJOR_CHANGE_WINDOW_SIZE} comparable interactions before repeated-change analysis is available.`
      )
    }

    if (
      summary.unusualCount === 0
    ) {
      return (
        'The last five comparable interactions stayed within the current personal baseline ranges.'
      )
    }

    const metrics = [
      {
        name:
          'handling duration',
        count:
          summary.durationCount,
      },
      {
        name:
          'total motion',
        count:
          summary.motionCount,
      },
      {
        name:
          'movement variability',
        count:
          summary.variabilityCount,
      },
    ].sort(
      (a, b) =>
        b.count - a.count
    )

    const dominant =
      metrics[0]

    if (
      summary.qualifies
    ) {
      return (
        `${summary.unusualCount} of the last ${MAJOR_CHANGE_WINDOW_SIZE} comparable interactions were outside baseline. ` +
        `${dominant.name} was the most frequently changed metric (${dominant.count} of ${MAJOR_CHANGE_WINDOW_SIZE}).`
      )
    }

    return (
      `${summary.unusualCount} of the last ${MAJOR_CHANGE_WINDOW_SIZE} comparable interactions were outside baseline. ` +
      'The persistence threshold for a Major Change has not been reached.'
    )
  }

  const whatChangedText =
    buildWhatChangedText()

  /* =========================================================
     TRENDS
     ========================================================= */

  const trendEvents =
    [...eventLog.slice(0, 10)]
      .reverse()

  const durationTrend =
    trendEvents.map(
      (event) =>
        event.durationMs
    )

  const variabilityTrend =
    trendEvents.map(
      (event) =>
        event.motionVariability
    )

  const averageMotionTrend =
    trendEvents.map(
      (event) =>
        event.averageMotion
    )

  const peakMotionTrend =
    trendEvents.map(
      (event) =>
        event.peakMotion
    )

  const tiltTrend =
    trendEvents.map(
      (event) =>
        event.maxTiltAngle
    )

  /* =========================================================
     CHECK-INS
     ========================================================= */

  function saveCheckIn(
    response
  ) {
    const checkInTime =
      new Date()

    const checkIn = {
      id:
        `checkin-${Date.now()}`,

      response,

      recordedAtISO:
        checkInTime.toISOString(),

      recordedDate:
        checkInTime.toLocaleDateString(),

      clockTime:
        checkInTime.toLocaleTimeString(),
    }

    setCheckIns(
      (oldCheckIns) => [
        checkIn,
        ...oldCheckIns,
      ].slice(0, 100)
    )
  }

  const latestCheckIn =
    checkIns[0] || null

  /* =========================================================
     MAJOR CHANGE ENGINE
     ========================================================= */

  function evaluateMajorChange(
    updatedEvents,
    triggerEvent
  ) {
    const summary =
      getRecentDeviationSummary(
        updatedEvents
      )

    /*
      IMPORTANT:

      If threshold falls below 3/5,
      the current episode has reset.

      A later 3/5 cluster may then
      create a NEW Major Change.
    */

    if (!summary.qualifies) {
      majorChangeActiveRef.current =
        false

      return
    }

    /*
      We are already inside a surfaced
      major-change episode.

      Do NOT create another marker for
      every overlapping 5-event window.
    */

    if (
      majorChangeActiveRef.current
    ) {
      return
    }

    const marker =
      createMajorChangeMarker(
        summary,
        triggerEvent
      )

    majorChangeActiveRef.current =
      true

    setMajorChanges(
      (oldChanges) => {
        const updated = [
          marker,
          ...oldChanges,
        ].slice(0, 50)

        majorChangesRef.current =
          updated

        return updated
      }
    )
  }

  /* =========================================================
     LOGIN
     ========================================================= */

  const rotatingTerm =
    ROTATING_TERMS[
      rotatingTermIndex
    ]

  function handleLogin(
    event
  ) {
    event.preventDefault()

    setSession(
      loginRole
    )

    setLoginPassword('')
  }

  function signOut() {
    setSession(null)

    setLoginPassword('')
  }

  /* =========================================================
     DETECTION ENGINE
     ========================================================= */

  function resetCounters() {
    handlingCountRef.current = 0
    tiltCountRef.current = 0
    returnCountRef.current = 0
    idleCountRef.current = 0
  }

  function calculateMotorTelemetry(
    interaction,
    endTime
  ) {
    const samples =
      interaction.samples

    const motionValues =
      samples.map(
        (sample) =>
          sample.motionAmount
      )

    const tiltValues =
      samples.map(
        (sample) =>
          sample.tiltAngleDegrees
      )

    const durationMs =
      endTime -
      interaction.startTime

    return {
      durationMs,

      sampleCount:
        samples.length,

      maxTiltAngle:
        Math.max(
          ...tiltValues,
          0
        ),

      averageTiltAngle:
        average(
          tiltValues
        ),

      totalMotion:
        sum(
          motionValues
        ),

      averageMotion:
        average(
          motionValues
        ),

      peakMotion:
        Math.max(
          ...motionValues,
          0
        ),

      motionVariability:
        standardDeviation(
          motionValues
        ),
    }
  }

  function addRejectedInteraction(
    t_ms,
    reason,
    interaction
  ) {
    const telemetry =
      interaction
        ? calculateMotorTelemetry(
            interaction,
            t_ms
          )
        : {
            durationMs: 0,
            maxTiltAngle: 0,
          }

    const rejection = {
      id:
        rejectionIdRef.current,

      arduinoTime:
        t_ms,

      reason,

      durationMs:
        telemetry.durationMs,

      touchSeen:
        interaction
          ? interaction.touchSeen
          : false,

      maxTiltAngle:
        telemetry.maxTiltAngle,

      clockTime:
        new Date().toLocaleTimeString(),
    }

    rejectionIdRef.current += 1

    setRejectionLog(
      (oldRejections) => [
        rejection,
        ...oldRejections,
      ].slice(0, 8)
    )
  }

  /* =========================================================
     VALID INTERACTION

     THIS IS WHERE THE NEW BASELINE
     AND 3-OF-5 LOGIC ENTERS.
     ========================================================= */

  function tryLogMedicationInteraction(
    t_ms
  ) {
    if (
      eventAlreadyDecidedRef.current
    ) {
      return
    }

    const interaction =
      currentInteractionRef.current

    if (!interaction) {
      return
    }

    const telemetry =
      calculateMotorTelemetry(
        interaction,
        t_ms
      )

    const cooldownActive =
      t_ms -
        lastEventTimeRef.current <
      EVENT_COOLDOWN_MS

    if (cooldownActive) {
      eventAlreadyDecidedRef.current =
        true

      addRejectedInteraction(
        t_ms,
        'Rejected: cooldown active',
        interaction
      )

      return
    }

    if (!interaction.touchSeen) {
      eventAlreadyDecidedRef.current =
        true

      addRejectedInteraction(
        t_ms,
        'Rejected: no touch detected',
        interaction
      )

      return
    }

    if (
      telemetry.maxTiltAngle <
      TILT_THRESHOLD_DEGREES
    ) {
      eventAlreadyDecidedRef.current =
        true

      addRejectedInteraction(
        t_ms,
        'Rejected: tilt too small',
        interaction
      )

      return
    }

    if (
      telemetry.durationMs <
      MIN_EVENT_DURATION_MS
    ) {
      eventAlreadyDecidedRef.current =
        true

      addRejectedInteraction(
        t_ms,
        'Rejected: too fast',
        interaction
      )

      return
    }

    if (
      telemetry.durationMs >
      MAX_EVENT_DURATION_MS
    ) {
      eventAlreadyDecidedRef.current =
        true

      addRejectedInteraction(
        t_ms,
        'Rejected: too long',
        interaction
      )

      return
    }

    /*
      IMPORTANT:

      eventLogRef.current contains ONLY
      prior valid interactions.

      We calculate the new interaction
      against those prior events.
    */

    const priorEvents =
      eventLogRef.current

    const baselineComparison =
      calculateEventBaselineComparison(
        telemetry,
        priorEvents
      )

    const eventTime =
      new Date()

    const medicationEvent = {
      id:
        eventIdRef.current,

      arduinoTime:
        t_ms,

      recordedAtISO:
        eventTime.toISOString(),

      recordedDate:
        eventTime.toLocaleDateString(),

      clockTime:
        eventTime.toLocaleTimeString(),

      touchSeen:
        interaction.touchSeen,

      ...telemetry,

      /*
        NEW:
        every valid event now remembers
        how it compared with the baseline
        that existed BEFORE it.
      */

      baselineComparison,
    }

    eventIdRef.current += 1

    lastEventTimeRef.current =
      t_ms

    eventAlreadyDecidedRef.current =
      true

    const updatedEvents = [
      medicationEvent,
      ...priorEvents,
    ].slice(0, 100)

    eventLogRef.current =
      updatedEvents

    setEventLog(
      updatedEvents
    )

    /*
      The local detector remains authoritative for accepted-event
      gating. Queue the accepted event for the API after that decision.
      The same UUID is retained for safe backend retry handling.
    */

    queueInteractionEvent({
      event_id: createApiEventId(),
      patient_id: API_PATIENT_ID,
      device_id: API_DEVICE_ID,
      recorded_at: medicationEvent.recordedAtISO,
      device_uptime_ms: Math.max(
        0,
        Math.round(medicationEvent.arduinoTime)
      ),
      detector_version: DETECTOR_VERSION,
      duration_ms: Math.round(
        medicationEvent.durationMs
      ),
      touch_seen: medicationEvent.touchSeen,
      max_tilt_degrees: medicationEvent.maxTiltAngle,
      average_tilt_degrees:
        medicationEvent.averageTiltAngle,
      total_motion_score:
        medicationEvent.totalMotion,
      average_motion_score:
        medicationEvent.averageMotion,
      peak_motion_score:
        medicationEvent.peakMotion,
      motion_variability_score:
        medicationEvent.motionVariability,
      sample_count: medicationEvent.sampleCount,

      /* Context schema remains a separate shared service contract. */
      baseline: null,
      percent_changes: null,
      schedule_match: null,
    }, {
      reference: { ...interaction.reference },
      initial_sample: interaction.initialSample,
      start_ms: interaction.startTime,
      end_ms: t_ms,
      samples: interaction.samples.map(({t_ms, ax, ay, az}) => ({t_ms, ax, ay, az})),
    })

    void flushPendingEventUploads()

    /*
      One unusual event is stored silently.

      Only repeated unusual events may
      create a Major Change.
    */

    evaluateMajorChange(
      updatedEvents,
      medicationEvent
    )
  }

  function changeState(
    newState,
    t_ms,
    context = {}
  ) {
    const oldState =
      movementStateRef.current

    if (
      oldState === newState
    ) {
      return
    }

    movementStateRef.current =
      newState

    stateStartedAtRef.current =
      t_ms

    setMovementState(
      newState
    )

    resetCounters()

    if (
      oldState === 'IDLE' &&
      newState === 'HANDLING'
    ) {
      currentInteractionRef.current = {
        startTime:
          t_ms,

        touchSeen:
          context.touch === 1,

        // Freeze calibration and the trigger sample for exact first-delta parity.
        reference: { ...restBaselineRef.current },
        initialSample: { ...previousDataRef.current },
        samples: [],
      }

      eventAlreadyDecidedRef.current =
        false
    }

    if (
      oldState === 'TILTED' &&
      newState === 'RETURNED'
    ) {
      tryLogMedicationInteraction(
        t_ms
      )
    }

    if (
      oldState === 'RETURNED' &&
      newState === 'IDLE'
    ) {
      currentInteractionRef.current =
        null

      eventAlreadyDecidedRef.current =
        false
    }

    setStateHistory(
      (oldHistory) => [
        {
          state: newState,
          time: t_ms,
        },
        ...oldHistory,
      ].slice(0, 10)
    )
  }

  function calibrateRest() {
    const newBaseline =
      averageSamples(
        recentSamplesRef.current
      )

    if (!newBaseline) {
      alert(
        'No samples yet. Connect Arduino first.'
      )

      return
    }

    restBaselineRef.current =
      newBaseline

    setRestBaseline(
      newBaseline
    )

    movementStateRef.current =
      'IDLE'

    stateStartedAtRef.current =
      sensorData.t_ms

    previousDataRef.current =
      null

    currentInteractionRef.current =
      null

    eventAlreadyDecidedRef.current =
      false

    resetCounters()

    setMovementState(
      'IDLE'
    )

    setStateHistory([
      {
        state: 'IDLE',

        time:
          sensorData.t_ms,
      },
    ])
  }

  function updateMovementState(
    data
  ) {
    const {
      t_ms,
      touch,
      ax,
      ay,
      az,
    } = data

    const currentVector = {
      ax,
      ay,
      az,
    }

    const tiltAngleDegrees =
      angleBetweenVectorsDegrees(
        restBaselineRef.current,
        currentVector
      )

    const previousData =
      previousDataRef.current

    let motionAmount = 0

    if (previousData) {
      motionAmount =
        Math.abs(
          ax -
            previousData.ax
        ) +
        Math.abs(
          ay -
            previousData.ay
        ) +
        Math.abs(
          az -
            previousData.az
        )
    }

    previousDataRef.current =
      data

    const isTilted =
      tiltAngleDegrees >
      TILT_THRESHOLD_DEGREES

    const isMoving =
      motionAmount >
      MOTION_THRESHOLD

    const isAtRest =
      tiltAngleDegrees <
        REST_THRESHOLD_DEGREES &&
      !isMoving

    const isReturned =
      tiltAngleDegrees <
      RETURN_THRESHOLD_DEGREES

    const cooldownActive =
      t_ms -
        lastEventTimeRef.current <
      EVENT_COOLDOWN_MS

    if (
      currentInteractionRef.current
    ) {
      if (
        touch === 1
      ) {
        currentInteractionRef.current.touchSeen =
          true
      }

      currentInteractionRef.current.samples.push(
        {
          t_ms,
          touch,
          ax,
          ay,
          az,
          tiltAngleDegrees,
          motionAmount,
        }
      )
    }

    setDebug({
      tiltAngleDegrees,
      motionAmount,
      isTilted,
      isMoving,
      isAtRest,
      cooldownActive,
    })

    const currentState =
      movementStateRef.current

    const timeInCurrentState =
      t_ms -
      stateStartedAtRef.current

    if (
      currentState === 'IDLE'
    ) {
      if (
        isMoving ||
        tiltAngleDegrees >
          REST_THRESHOLD_DEGREES
      ) {
        handlingCountRef.current += 1
      } else {
        handlingCountRef.current = 0
      }

      if (
        handlingCountRef.current >=
          2 ||
        isTilted
      ) {
        changeState(
          'HANDLING',
          t_ms,
          {
            touch,
            tiltAngleDegrees,
          }
        )
      }

      return
    }

    if (
      currentState === 'HANDLING'
    ) {
      if (isTilted) {
        tiltCountRef.current += 1
      } else {
        tiltCountRef.current = 0
      }

      if (
        timeInCurrentState >=
          500 &&
        tiltCountRef.current >= 1
      ) {
        changeState(
          'TILTED',
          t_ms,
          {
            touch,
            tiltAngleDegrees,
          }
        )
      }

      if (
        isAtRest &&
        touch === 0
      ) {
        idleCountRef.current += 1
      } else {
        idleCountRef.current = 0
      }

      if (
        idleCountRef.current >= 5
      ) {
        changeState(
          'IDLE',
          t_ms,
          {
            touch,
            tiltAngleDegrees,
          }
        )
      }

      return
    }

    if (
      currentState === 'TILTED'
    ) {
      if (isReturned) {
        returnCountRef.current += 1
      } else {
        returnCountRef.current = 0
      }

      if (
        timeInCurrentState >=
          500 &&
        returnCountRef.current >= 2
      ) {
        changeState(
          'RETURNED',
          t_ms,
          {
            touch,
            tiltAngleDegrees,
          }
        )
      }

      return
    }

    if (
      currentState === 'RETURNED'
    ) {
      if (
        isAtRest &&
        touch === 0
      ) {
        idleCountRef.current += 1
      } else {
        idleCountRef.current = 0
      }

      if (
        timeInCurrentState >=
          1000 &&
        idleCountRef.current >=
          3
      ) {
        changeState(
          'IDLE',
          t_ms,
          {
            touch,
            tiltAngleDegrees,
          }
        )
      }
    }
  }

  /* =========================================================
     ARDUINO
     ========================================================= */

  async function connectArduino() {
    if (
      !(
        'serial' in navigator
      )
    ) {
      alert(
        'Web Serial is not supported. Please use Google Chrome.'
      )

      return
    }

    try {
      const port =
        await navigator.serial.requestPort()

      await port.open({
        baudRate: 115200,
      })

      setConnected(true)

      const decoder =
        new TextDecoderStream()

      port.readable.pipeTo(
        decoder.writable
      )

      const reader =
        decoder.readable.getReader()

      let buffer = ''

      while (true) {
        const {
          value,
          done,
        } =
          await reader.read()

        if (done) {
          break
        }

        buffer += value

        const lines =
          buffer.split('\n')

        buffer =
          lines.pop()

        for (
          const line of lines
        ) {
          const cleanLine =
            line.trim()

          if (!cleanLine) {
            continue
          }

          setLastLine(
            cleanLine
          )

          const parsed =
            parseSensorLine(
              cleanLine
            )

          if (!parsed) {
            continue
          }

          setSensorData(
            parsed
          )

          recentSamplesRef.current = [
            ...recentSamplesRef.current,
            parsed,
          ].slice(-12)

          updateMovementState(
            parsed
          )
        }
      }
    } catch (error) {
      console.error(error)

      setConnected(false)

      alert(
        'Could not connect to Arduino. Close Arduino Serial Monitor, unplug/replug the Arduino, then try again.'
      )
    }
  }

  function resetState() {
    movementStateRef.current =
      'IDLE'

    stateStartedAtRef.current =
      sensorData.t_ms

    previousDataRef.current =
      null

    currentInteractionRef.current =
      null

    eventAlreadyDecidedRef.current =
      false

    resetCounters()

    setMovementState(
      'IDLE'
    )

    setStateHistory([
      {
        state: 'IDLE',

        time:
          sensorData.t_ms,
      },
    ])
  }

  function clearEventLog() {
    setEventLog([])

    eventLogRef.current = []

    eventIdRef.current = 1

    lastEventTimeRef.current =
      -999999

    majorChangeActiveRef.current =
      false

    localStorage.removeItem(
      EVENT_STORAGE_KEY
    )
  }

  function clearRejectionLog() {
    setRejectionLog([])

    rejectionIdRef.current = 1
  }

  function clearMajorChanges() {
    setMajorChanges([])

    majorChangesRef.current = []

    majorChangeActiveRef.current =
      getRecentDeviationSummary(
        eventLogRef.current
      ).qualifies

    localStorage.removeItem(
      MAJOR_CHANGE_STORAGE_KEY
    )
  }

  /* =========================================================
     APPOINTMENT SUMMARY
     ========================================================= */

  const latestMajorChange =
    majorChanges[0] || null

  function printAppointmentSummary() {
    window.print()
  }

  /* =========================================================
     LOGIN PAGE
     ========================================================= */

  if (!session) {
    return (
      <div className="login-page">
        <div className="login-brand-panel">
          <LogoMark />

          <div className="login-message">
            <p className="login-kicker">
              Care between appointments
            </p>

            <h2>
              Medication support
              built around{' '}
              <span
                className="rotating-login-word"
                key={rotatingTerm}
              >
                {rotatingTerm}
              </span>
              .
            </h2>

            <p>
              AcuPill helps patients
              maintain their medication
              routine while preserving
              meaningful movement and
              interaction history for
              caregivers and clinicians.
            </p>
          </div>

          <div className="login-trust-row">
            <span>
              Medication routine
            </span>

            <span>
              Movement history
            </span>

            <span>
              Appointment memory
            </span>
          </div>
        </div>

        <div className="login-form-panel">
          <div className="login-box">
            <p className="eyebrow">
              Welcome to AcuPill
            </p>

            <h2 className="login-heading">
              Sign in
            </h2>

            <p className="login-description">
              Choose how you use
              AcuPill.
            </p>

            <div className="role-selector">
              <button
                type="button"
                className={
                  loginRole ===
                  'patient'
                    ? 'role-option active'
                    : 'role-option'
                }
                onClick={() =>
                  setLoginRole(
                    'patient'
                  )
                }
              >
                <span className="role-icon">
                  P
                </span>

                <span>
                  <strong>
                    Patient
                  </strong>

                  <small>
                    My routine &
                    support
                  </small>
                </span>
              </button>

              <button
                type="button"
                className={
                  loginRole ===
                  'caregiver'
                    ? 'role-option active'
                    : 'role-option'
                }
                onClick={() =>
                  setLoginRole(
                    'caregiver'
                  )
                }
              >
                <span className="role-icon">
                  C
                </span>

                <span>
                  <strong>
                    Care Team / Clinic
                  </strong>

                  <small>
                    Patient trends &
                    insights
                  </small>
                </span>
              </button>
            </div>

            <form
              onSubmit={
                handleLogin
              }
              className="login-form"
            >
              <label>
                Email

                <input
                  type="email"
                  value={
                    loginEmail
                  }
                  onChange={(
                    event
                  ) =>
                    setLoginEmail(
                      event.target
                        .value
                    )
                  }
                  placeholder={
                    loginRole ===
                    'patient'
                      ? 'patient@example.com'
                      : 'clinician@clinic.com'
                  }
                />
              </label>

              <label>
                Password

                <input
                  type="password"
                  value={
                    loginPassword
                  }
                  onChange={(
                    event
                  ) =>
                    setLoginPassword(
                      event.target
                        .value
                    )
                  }
                  placeholder="••••••••"
                />
              </label>

              <button
                className="login-submit"
                type="submit"
              >
                {loginRole ===
                'patient'
                  ? 'Continue to my dashboard'
                  : 'Continue to care dashboard'}
              </button>
            </form>

            <p className="demo-note">
              Demo mode —
              authentication will be
              connected to the backend
              later.
            </p>

            <div className="engineering-access">
              <button
                type="button"
                onClick={() =>
                  setSession(
                    'engineering'
                  )
                }
              >
                Engineering access
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  /* =========================================================
     LOGGED-IN APP
     ========================================================= */

  return (
    <div className="app-shell">
      <header className="app-header">
        <LogoMark />

        <div className="app-header-right">
          {session ===
            'patient' && (
            <span className="role-badge">
              Patient
            </span>
          )}

          {session ===
            'caregiver' && (
            <span className="role-badge">
              Care Team / Clinic
            </span>
          )}

          {session ===
            'engineering' && (
            <span className="role-badge engineering-badge">
              Engineering
            </span>
          )}

          {session ===
            'engineering' && (
            <div
              className={
                connected
                  ? 'status-pill good'
                  : 'status-pill bad'
              }
            >
              <span className="pulse-dot" />

              {connected
                ? 'Connected'
                : 'Disconnected'}
            </div>
          )}

          <button
            className="signout-button"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* =====================================================
          PATIENT DASHBOARD
          ===================================================== */}

      {session === 'patient' && (
        <main className="dashboard-view">
          <section className="patient-welcome">
            <p className="eyebrow">
              Patient support
            </p>

            <h2 className="patient-title">
              Your medication routine
            </h2>

            <p className="patient-intro">
              AcuPill helps track
              medication-bottle
              interactions and remembers
              important changes between
              appointments.
            </p>
          </section>



          <section className="patient-grid">
            <div className="patient-feature">
              <p className="card-label">
                Next medication
              </p>

              {nextMedication ? (
                <>
                  <p className="patient-big-value">
                    {formatScheduleTime(
                      nextMedication.time
                    )}
                  </p>

                  <p className="next-medication-label">
                    {nextMedication.label}
                  </p>

                  <p className="patient-helper">
                    {nextMedication.isTomorrow
                      ? 'Tomorrow'
                      : 'Today'}
                  </p>
                </>
              ) : (
                <p className="patient-big-value">
                  No schedule
                </p>
              )}
            </div>

            <div className="patient-feature">
              <p className="card-label">
                Today's routine
              </p>

              <p className="patient-big-value">
                {todayCompleted}/
                {todayRoutine.length}
              </p>

              <p className="patient-helper">
                scheduled bottle
                interactions recorded
              </p>
            </div>

            <div className="patient-feature">
              <p className="card-label">
                Movement
              </p>

              <p className="patient-status-text">
                {patientMovementStatus}
              </p>
            </div>
          </section>

          {/* TODAY */}

          <section className="patient-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Today
                </p>

                <h2>
                  Medication routine
                </h2>
              </div>
            </div>

            <div className="dose-routine-list">
              {todayRoutine.map(
                (item) => (
                  <div
                    className="dose-routine-row"
                    key={item.id}
                  >
                    <div className="dose-time">
                      {formatScheduleTime(
                        item.time
                      )}
                    </div>

                    <div className="dose-main">
                      <strong>
                        {item.label}
                      </strong>

                      {item.matchedDate ? (
                        <p>
                          Bottle interaction
                          recorded at{' '}
                          {item.matchedDate.toLocaleTimeString()}
                        </p>
                      ) : (
                        <p>
                          {item.status ===
                          'upcoming'
                            ? 'Scheduled for later today.'
                            : item.status ===
                              'waiting'
                            ? 'No medication-bottle interaction has been recorded yet.'
                            : 'No medication-bottle interaction was recorded during the monitoring window.'}
                        </p>
                      )}
                    </div>

                    <span
                      className={`routine-status ${item.status}`}
                    >
                      {item.statusLabel}
                    </span>
                  </div>
                )
              )}
            </div>

            <p className="schedule-note">
              AcuPill detects
              medication-bottle
              interactions. It does not
              confirm medication ingestion.
            </p>
          </section>

          {/* WEEKLY */}

          <section className="patient-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Last 7 days
                </p>

                <h2>
                  Your weekly routine
                </h2>
              </div>
            </div>

            <div className="patient-week-grid">
              {weeklyRoutine.map(
                (day) => {
                  const today =
                    isSameDay(
                      day.date,
                      now
                    )

                  return (
                    <div
                      key={
                        day.date.toISOString()
                      }
                      className={
                        today
                          ? 'patient-week-day today'
                          : 'patient-week-day'
                      }
                    >
                      <p className="week-day-name">
                        {formatDayName(
                          day.date
                        )}
                      </p>

                      <p className="week-day-date">
                        {formatShortDate(
                          day.date
                        )}
                      </p>

                      <div className="week-score">
                        {day.completed}/
                        {day.scheduled}
                      </div>

                      <div className="week-status-line">
                        <span
                          className={
                            day.scheduled >
                              0 &&
                            day.completed ===
                              day.scheduled
                              ? 'week-dot complete'
                              : day.missing >
                                0
                              ? 'week-dot different'
                              : 'week-dot pending'
                          }
                        />

                        <span>
                          {day.scheduled ===
                          0
                            ? 'No schedule'
                            : day.completed ===
                              day.scheduled
                            ? 'Recorded'
                            : day.missing >
                              0
                            ? 'Some missing'
                            : 'In progress'}
                        </span>
                      </div>
                    </div>
                  )
                }
              )}
            </div>
          </section>

          {/* MAJOR CHANGE JOURNAL */}

          <section className="patient-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Appointment Memory
                </p>

                <h2>
                  Major changes
                </h2>
              </div>
            </div>

            {majorChanges.length ===
            0 ? (
              <div className="patient-message">
                <strong>
                  No repeated changes
                  have been saved yet.
                </strong>

                <p>
                  AcuPill watches for
                  repeated differences
                  rather than reacting to
                  one unusual interaction.
                </p>
              </div>
            ) : (
              <div className="patient-routine-list">
                {majorChanges.map(
                  (change) => {
                    const changeDate =
                      new Date(
                        change.createdAtISO
                      )

                    return (
                      <div
                        className="patient-routine-row"
                        key={change.id}
                      >
                        <div>
                          <strong>
                            {formatLongDate(
                              changeDate
                            )}
                          </strong>

                          <p>
                            Your
                            medication-handling
                            pattern was
                            different from your
                            recent routine.
                            Saved for your next
                            appointment.
                          </p>
                        </div>

                        <span className="routine-status recorded">
                          Saved
                        </span>
                      </div>
                    )
                  }
                )}
              </div>
            )}
          </section>

          {/* SCHEDULE */}

          <section className="patient-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Settings
                </p>

                <h2>
                  Medication schedule
                </h2>
              </div>
            </div>

            <div className="schedule-list">
              {schedule.map(
                (item) => (
                  <div
                    className="schedule-row"
                    key={item.id}
                  >
                    <div className="schedule-enabled">
                      <input
                        type="checkbox"
                        checked={
                          item.enabled
                        }
                        onChange={(
                          event
                        ) =>
                          updateScheduleItem(
                            item.id,
                            'enabled',
                            event.target
                              .checked
                          )
                        }
                      />
                    </div>

                    <div className="schedule-fields">
                      <label>
                        Medication

                        <input
                          type="text"
                          value={
                            item.label
                          }
                          onChange={(
                            event
                          ) =>
                            updateScheduleItem(
                              item.id,
                              'label',
                              event.target
                                .value
                            )
                          }
                        />
                      </label>

                      <label>
                        Time

                        <input
                          type="time"
                          value={
                            item.time
                          }
                          onChange={(
                            event
                          ) =>
                            updateScheduleItem(
                              item.id,
                              'time',
                              event.target
                                .value
                            )
                          }
                        />
                      </label>
                    </div>

                    <div className="schedule-preview">
                      <strong>
                        {formatScheduleTime(
                          item.time
                        )}
                      </strong>

                      <span>
                        {item.enabled
                          ? 'Active'
                          : 'Paused'}
                      </span>
                    </div>
                  </div>
                )
              )}
            </div>
          </section>

          {/* CHECK-IN */}

          <section className="patient-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Check-in
                </p>

                <h2>
                  How did handling your
                  medication feel today?
                </h2>
              </div>
            </div>

            <div className="checkin-options">
              <button
                className="checkin-button"
                onClick={() =>
                  saveCheckIn(
                    'Easy'
                  )
                }
              >
                Easy
              </button>

              <button
                className="checkin-button"
                onClick={() =>
                  saveCheckIn(
                    'A little difficult'
                  )
                }
              >
                A little difficult
              </button>

              <button
                className="checkin-button"
                onClick={() =>
                  saveCheckIn(
                    'Difficult'
                  )
                }
              >
                Difficult
              </button>
            </div>

            {latestCheckIn && (
              <p className="schedule-note">
                Latest check-in:{' '}
                <strong>
                  {latestCheckIn.response}
                </strong>{' '}
                at{' '}
                {latestCheckIn.clockTime}
              </p>
            )}
          </section>
        </main>
      )}

      {/* =====================================================
          CAREGIVER / CLINICIAN
          ===================================================== */}

      {session ===
        'caregiver' && (
        <main className="dashboard-view">
          <CaregiverMockPreview />

          <details className="section-block">
            <summary>
              Current device session — existing caregiver view
            </summary>

            <p className="demo-note">
              The following view uses local device-session data,
              separate from the mock preview above.
            </p>

          <section className="caregiver-summary">
            <div>
              <p className="eyebrow">
                Caregiver / clinician
              </p>

              <h2 className="caregiver-title">
                Patient overview
              </h2>

              <p className="patient-intro">
                Review medication
                interaction patterns,
                repeated deviations, and
                longitudinal movement
                telemetry.
              </p>
            </div>

            <div
              className={`caregiver-callout ${insightTone}`}
            >
              <p className="card-label">
                Repeated-deviation
                indicator
              </p>

              <strong>
                {repeatedDeviationText}
              </strong>

              <p className="tiny-text">
                Major Change threshold:
                3 of last 5 comparable
                interactions.
              </p>
            </div>
          </section>

          {/* WHAT CHANGED */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Pattern summary
                </p>

                <h2>
                  What changed?
                </h2>
              </div>
            </div>

            <div className="patient-message">
              <strong>
                {baselineInsight}
              </strong>

              <p>
                {whatChangedText}
              </p>
            </div>
          </section>

          {/* WEEK ROUTINE */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Last 7 days
                </p>

                <h2>
                  Medication interaction
                  routine
                </h2>
              </div>
            </div>

            <div className="routine-summary-grid">
              <MetricCard
                label="Scheduled"
                value={
                  weeklyTotals.scheduled
                }
              />

              <MetricCard
                label="Recorded"
                value={
                  weeklyTotals.recorded
                }
              />

              <MetricCard
                label="Recorded late"
                value={
                  weeklyTotals.late
                }
              />

              <MetricCard
                label="No interaction"
                value={
                  weeklyTotals.missing
                }
              />
            </div>

            <div className="weekly-clinician-table">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Scheduled</th>
                    <th>Recorded</th>
                    <th>Late</th>
                    <th>No interaction</th>
                    <th>Pending</th>
                  </tr>
                </thead>

                <tbody>
                  {[...weeklyRoutine]
                    .reverse()
                    .map(
                      (day) => (
                        <tr
                          key={
                            day.date.toISOString()
                          }
                        >
                          <td>
                            <strong>
                              {formatDayName(
                                day.date
                              )}
                            </strong>{' '}
                            {formatShortDate(
                              day.date
                            )}
                          </td>

                          <td>
                            {day.scheduled}
                          </td>

                          <td>
                            {day.recorded}
                          </td>

                          <td>
                            {day.late}
                          </td>

                          <td>
                            {day.missing}
                          </td>

                          <td>
                            {day.waiting}
                          </td>
                        </tr>
                      )
                    )}
                </tbody>
              </table>
            </div>

            <p className="schedule-note">
              These statuses describe
              recorded medication-bottle
              interactions only.
            </p>
          </section>

          {/* TELEMETRY TRENDS */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Last 10 valid
                  interactions
                </p>

                <h2>
                  Handling trends
                </h2>
              </div>
            </div>

            <div className="metric-grid">
              <TrendCard
                label="Handling duration"
                values={
                  durationTrend
                }
                formatter={(
                  value
                ) =>
                  `${Math.round(
                    value
                  )} ms`
                }
              />

              <TrendCard
                label="Movement variability"
                values={
                  variabilityTrend
                }
                formatter={(
                  value
                ) =>
                  value.toFixed(3)
                }
              />

              <TrendCard
                label="Average motion"
                values={
                  averageMotionTrend
                }
                formatter={(
                  value
                ) =>
                  value.toFixed(3)
                }
              />

              <TrendCard
                label="Peak motion"
                values={
                  peakMotionTrend
                }
                formatter={(
                  value
                ) =>
                  value.toFixed(3)
                }
              />

              <TrendCard
                label="Max tilt"
                values={
                  tiltTrend
                }
                formatter={(
                  value
                ) =>
                  `${value.toFixed(
                    1
                  )}°`
                }
              />
            </div>
          </section>

          {/* MAJOR CHANGE TIMELINE */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Longitudinal change
                  record
                </p>

                <h2>
                  Major Change timeline
                </h2>
              </div>

              <button
                className="danger-button"
                onClick={
                  clearMajorChanges
                }
                disabled={
                  majorChanges.length ===
                  0
                }
              >
                Clear markers
              </button>
            </div>

            {majorChanges.length ===
            0 ? (
              <div className="empty-card">
                No Major Change markers
                have been generated yet.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>
                        Repeated deviation
                      </th>
                      <th>
                        Duration
                      </th>
                      <th>
                        Total motion
                      </th>
                      <th>
                        Variability
                      </th>
                      <th>
                        Events
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {majorChanges.map(
                      (change) => (
                        <tr
                          key={
                            change.id
                          }
                        >
                          <td>
                            {formatLongDate(
                              new Date(
                                change.createdAtISO
                              )
                            )}
                          </td>

                          <td>
                            {
                              change.unusualCount
                            }{' '}
                            of{' '}
                            {
                              change.windowSize
                            }
                          </td>

                          <td>
                            {formatPercent(
                              change.averageDurationPct
                            )}
                          </td>

                          <td>
                            {formatPercent(
                              change.averageTotalMotionPct
                            )}
                          </td>

                          <td>
                            {formatPercent(
                              change.averageVariabilityPct
                            )}
                          </td>

                          <td>
                            {change.eventIds.join(
                              ', '
                            )}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* LATEST */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Latest result
                </p>

                <h2>
                  Medication interaction
                </h2>
              </div>
            </div>

            {latestEvent ? (
              <div className="metric-grid">
                <MetricCard
                  label="Status"
                  value="Detected"
                  subtext="Medication-bottle interaction"
                />

                <MetricCard
                  label="Duration"
                  value={formatMs(
                    latestEvent.durationMs
                  )}
                />

                <MetricCard
                  label="Max tilt"
                  value={`${formatNumber(
                    latestEvent.maxTiltAngle,
                    1
                  )}°`}
                />

                <MetricCard
                  label="Total motion"
                  value={formatNumber(
                    latestEvent.totalMotion,
                    3
                  )}
                />

                <MetricCard
                  label="Movement variability"
                  value={formatNumber(
                    latestEvent.motionVariability,
                    3
                  )}
                />

                <MetricCard
                  label="Baseline status"
                  value={
                    !latestEvent
                      .baselineComparison
                      ?.hasBaseline
                      ? 'Building'
                      : latestEvent
                          .baselineComparison
                          .outsideBaseline
                      ? 'Outside range'
                      : 'Within range'
                  }
                />
              </div>
            ) : (
              <div className="empty-card">
                No medication-bottle
                interaction has been
                detected yet.
              </div>
            )}
          </section>

          {/* BASELINE */}

          <section className="section-block two-column">
            <div>
              <p className="eyebrow">
                Personal baseline
              </p>

              <h2>
                Handling pattern
              </h2>

              {baseline ? (
                <div className="mini-grid">
                  <MetricCard
                    label="Events"
                    value={
                      baseline.count
                    }
                  />

                  <MetricCard
                    label="Avg duration"
                    value={`${baseline.durationMs.toFixed(
                      0
                    )} ms`}
                  />

                  <MetricCard
                    label="Avg max tilt"
                    value={`${baseline.maxTiltAngle.toFixed(
                      1
                    )}°`}
                  />

                  <MetricCard
                    label="Avg total motion"
                    value={baseline.totalMotion.toFixed(
                      3
                    )}
                  />

                  <MetricCard
                    label="Avg variability"
                    value={baseline.motionVariability.toFixed(
                      3
                    )}
                  />
                </div>
              ) : (
                <p>
                  No baseline yet.
                </p>
              )}
            </div>

            <div>
              <p className="eyebrow">
                Latest comparison
              </p>

              <h2>
                Latest vs baseline
              </h2>

              {latestEvent &&
              baseline &&
              baseline.count >=
                3 ? (
                <div className="comparison-list">
                  <p>
                    Duration change

                    <strong>
                      {formatPercent(
                        durationChange
                      )}
                    </strong>
                  </p>

                  <p>
                    Total motion
                    change

                    <strong>
                      {formatPercent(
                        motionChange
                      )}
                    </strong>
                  </p>

                  <p>
                    Variability change

                    <strong>
                      {formatPercent(
                        variabilityChange
                      )}
                    </strong>
                  </p>
                </div>
              ) : (
                <p>
                  More interactions are
                  needed.
                </p>
              )}
            </div>
          </section>

          {/* PATIENT CHECK-INS */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Patient-reported
                  context
                </p>

                <h2>
                  Recent check-ins
                </h2>
              </div>
            </div>

            {checkIns.length ===
            0 ? (
              <div className="empty-card">
                No patient check-ins
                recorded yet.
              </div>
            ) : (
              <div className="table-wrap state-table">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Response</th>
                    </tr>
                  </thead>

                  <tbody>
                    {checkIns
                      .slice(0, 10)
                      .map(
                        (checkIn) => (
                          <tr
                            key={
                              checkIn.id
                            }
                          >
                            <td>
                              {
                                checkIn.recordedDate
                              }
                            </td>

                            <td>
                              {
                                checkIn.clockTime
                              }
                            </td>

                            <td>
                              {
                                checkIn.response
                              }
                            </td>
                          </tr>
                        )
                      )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* APPOINTMENT SUMMARY */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Appointment report
                </p>

                <h2>
                  Appointment summary
                </h2>
              </div>

              <button
                className="primary-button"
                onClick={
                  printAppointmentSummary
                }
              >
                Print summary
              </button>
            </div>

            <div className="patient-message">
              <strong>
                7-day routine
              </strong>

              <p>
                {
                  weeklyTotals.recorded
                }{' '}
                recorded on time,{' '}
                {
                  weeklyTotals.late
                }{' '}
                recorded late, and{' '}
                {
                  weeklyTotals.missing
                }{' '}
                scheduled
                medication-bottle
                interactions with no
                recorded interaction.
              </p>
            </div>

            <div className="patient-message">
              <strong>
                Movement pattern
              </strong>

              <p>
                {repeatedDeviationText}.
              </p>
            </div>

            <div className="patient-message">
              <strong>
                Appointment Memory
              </strong>

              <p>
                {majorChanges.length ===
                0
                  ? 'No Major Change markers have been saved.'
                  : `${majorChanges.length} Major Change marker${
                      majorChanges.length ===
                      1
                        ? ''
                        : 's'
                    } saved. Most recent: ${formatLongDate(
                      new Date(
                        latestMajorChange.createdAtISO
                      )
                    )}.`}
              </p>
            </div>

            <div className="patient-message">
              <strong>
                Patient check-in
              </strong>

              <p>
                {latestCheckIn
                  ? `Most recent response: ${latestCheckIn.response} on ${latestCheckIn.recordedDate}.`
                  : 'No patient-reported handling difficulty has been recorded yet.'}
              </p>
            </div>

            <p className="schedule-note">
              AcuPill describes
              medication-bottle
              interactions and movement
              patterns. These measurements
              are not a diagnosis and do
              not confirm medication
              ingestion.
            </p>
          </section>

          {/* COMPLETE EVENT HISTORY */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Longitudinal record
                </p>

                <h2>
                  Interaction history
                </h2>
              </div>

              <button
                className="danger-button"
                onClick={
                  clearEventLog
                }
                disabled={
                  eventLog.length === 0
                }
              >
                Clear history
              </button>
            </div>

            {eventLog.length ===
            0 ? (
              <div className="empty-card">
                No saved interactions yet.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Duration</th>
                      <th>Max tilt</th>
                      <th>Total motion</th>
                      <th>Avg motion</th>
                      <th>Peak motion</th>
                      <th>Variability</th>
                      <th>Baseline</th>
                    </tr>
                  </thead>

                  <tbody>
                    {eventLog.map(
                      (
                        event,
                        index
                      ) => (
                        <tr
                          key={
                            event.id
                          }
                          className={
                            index === 0
                              ? 'fresh'
                              : ''
                          }
                        >
                          <td>
                            {event.id}
                          </td>

                          <td>
                            {event.recordedDate ||
                              'Older event'}
                          </td>

                          <td>
                            {event.clockTime}
                          </td>

                          <td>
                            {formatMs(
                              event.durationMs
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              event.maxTiltAngle,
                              1
                            )}
                            °
                          </td>

                          <td>
                            {formatNumber(
                              event.totalMotion,
                              3
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              event.averageMotion,
                              3
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              event.peakMotion,
                              3
                            )}
                          </td>

                          <td>
                            {formatNumber(
                              event.motionVariability,
                              3
                            )}
                          </td>

                          <td>
                            {!event
                              .baselineComparison
                              ?.hasBaseline
                              ? 'Building'
                              : event
                                  .baselineComparison
                                  .outsideBaseline
                              ? 'Outside'
                              : 'Within'}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </details>
        </main>
      )}

      {/* =====================================================
          ENGINEERING
          ===================================================== */}

      {session ===
        'engineering' && (
        <main className="dashboard-view">
          <section className="engineering-header">
            <p className="eyebrow">
              Engineering
            </p>

            <h2 className="caregiver-title">
              Device & detection
              diagnostics
            </h2>

            <p>
              Raw sensor information,
              thresholds, and detector
              controls are kept separate
              from the patient experience.
            </p>
          </section>

          <section aria-label="Completed session analysis">
            <p className="card-label">Completed session analysis</p>
            <p>{motionAnalysis
              ? `Latest metrics: ${motionAnalysis.metrics_source === 'matlab' ? 'MATLAB' : 'JavaScript fallback'}`
              : 'Waiting for a new accepted interaction.'}</p>
            {motionAnalysis && <p className="tiny-text">
              Average jerk: {motionAnalysis.average_jerk?.toFixed(3) ?? 'Unavailable'} ·
              Peak jerk: {motionAnalysis.peak_jerk?.toFixed(3) ?? 'Unavailable'} (sensor units/s)
            </p>}
          </section>
          <section className="engineering-top-grid">
            <div className="engineering-feature">
              <p className="card-label">
                Device
              </p>

              <h2>
                {connected
                  ? 'Arduino online'
                  : 'Waiting for Arduino'}
              </h2>

              <button
                className="primary-button"
                onClick={
                  connectArduino
                }
                disabled={
                  connected
                }
              >
                Connect Arduino
              </button>

              <p className="tiny-text">
                Expected:
                t_ms,touch,ax,ay,az
              </p>
            </div>

            <div className="engineering-feature">
              <p className="card-label">
                Touch sensor
              </p>

              <h2
                key={
                  sensorData.touch
                }
                className={
                  sensorData.touch ===
                  1
                    ? 'touch-active tick'
                    : 'touch-idle tick'
                }
              >
                {sensorData.touch ===
                1
                  ? 'Touch active'
                  : 'Not touched'}
              </h2>

              <p className="tiny-text">
                Raw touch:{' '}
                {sensorData.touch}
              </p>
            </div>

            <div className="engineering-feature">
              <p className="card-label">
                Movement state
              </p>

              <h2
                key={
                  movementState
                }
                className="state-text tick"
              >
                {movementState}
              </h2>

              <button
                className="secondary-button"
                onClick={
                  resetState
                }
              >
                Reset state
              </button>
            </div>
          </section>

          <section className="section-block">
            <div className="debug-grid">
              <div className="engineering-feature">
                <h3>
                  Live serial
                </h3>

                <p className="mono">
                  {lastLine}
                </p>

                <p>
                  Time:{' '}
                  {sensorData.t_ms} ms
                </p>

                <p>
                  X: {sensorData.ax}
                </p>

                <p>
                  Y: {sensorData.ay}
                </p>

                <p>
                  Z: {sensorData.az}
                </p>
              </div>

              <div className="engineering-feature">
                <h3>
                  Rest calibration
                </h3>

                <p>
                  Rest X:{' '}
                  {restBaseline.ax.toFixed(
                    3
                  )}
                </p>

                <p>
                  Rest Y:{' '}
                  {restBaseline.ay.toFixed(
                    3
                  )}
                </p>

                <p>
                  Rest Z:{' '}
                  {restBaseline.az.toFixed(
                    3
                  )}
                </p>

                <button
                  className="secondary-button"
                  onClick={
                    calibrateRest
                  }
                  disabled={
                    !connected
                  }
                >
                  Calibrate rest
                </button>
              </div>

              <div className="engineering-feature">
                <h3>
                  Detection checks
                </h3>

                <p>
                  Tilt:{' '}
                  {debug.tiltAngleDegrees.toFixed(
                    1
                  )}
                  °
                </p>

                <p>
                  Motion:{' '}
                  {debug.motionAmount.toFixed(
                    3
                  )}
                </p>

                <p>
                  Tilted:{' '}
                  {debug.isTilted
                    ? 'Yes'
                    : 'No'}
                </p>

                <p>
                  Moving:{' '}
                  {debug.isMoving
                    ? 'Yes'
                    : 'No'}
                </p>

                <p>
                  At rest:{' '}
                  {debug.isAtRest
                    ? 'Yes'
                    : 'No'}
                </p>

                <p>
                  Cooldown:{' '}
                  {debug.cooldownActive
                    ? 'Active'
                    : 'No'}
                </p>
              </div>
            </div>
          </section>

          {/* MAJOR CHANGE SETTINGS */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Appointment Memory
                  detector
                </p>

                <h2>
                  Persistence thresholds
                </h2>
              </div>
            </div>

            <div className="metric-grid">
              <MetricCard
                label="Duration"
                value={`>${DURATION_DEVIATION_THRESHOLD}%`}
              />

              <MetricCard
                label="Total motion"
                value={`>${MOTION_DEVIATION_THRESHOLD}%`}
              />

              <MetricCard
                label="Variability"
                value={`>${VARIABILITY_DEVIATION_THRESHOLD}%`}
              />

              <MetricCard
                label="Persistence"
                value={`${MAJOR_CHANGE_REQUIRED_COUNT}/${MAJOR_CHANGE_WINDOW_SIZE}`}
                subtext="Outside baseline"
              />

              <MetricCard
                label="Baseline minimum"
                value={
                  MIN_BASELINE_EVENTS
                }
                subtext="Prior events"
              />
            </div>
          </section>

          {/* REJECTIONS */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  Detector
                </p>

                <h2>
                  Rejected interactions
                </h2>
              </div>
            </div>

            {rejectionLog.length ===
            0 ? (
              <div className="empty-card">
                No rejected interactions.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Reason</th>
                      <th>Duration</th>
                      <th>Touch</th>
                      <th>Max tilt</th>
                      <th>Clock</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rejectionLog.map(
                      (rejection) => (
                        <tr
                          key={
                            rejection.id
                          }
                        >
                          <td>
                            {rejection.id}
                          </td>

                          <td>
                            {rejection.reason}
                          </td>

                          <td>
                            {formatMs(
                              rejection.durationMs
                            )}
                          </td>

                          <td>
                            {rejection.touchSeen
                              ? 'Yes'
                              : 'No'}
                          </td>

                          <td>
                            {formatNumber(
                              rejection.maxTiltAngle,
                              1
                            )}
                            °
                          </td>

                          <td>
                            {rejection.clockTime}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <button
              className="secondary-button"
              onClick={
                clearRejectionLog
              }
              disabled={
                rejectionLog.length ===
                0
              }
            >
              Clear rejections
            </button>
          </section>

          {/* STATE HISTORY */}

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">
                  State machine
                </p>

                <h2>
                  State history
                </h2>
              </div>
            </div>

            {stateHistory.length ===
            0 ? (
              <div className="empty-card">
                No state changes yet.
              </div>
            ) : (
              <div className="table-wrap state-table">
                <table>
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Time</th>
                    </tr>
                  </thead>

                  <tbody>
                    {stateHistory.map(
                      (
                        entry,
                        index
                      ) => (
                        <tr
                          key={index}
                        >
                          <td>
                            {entry.state}
                          </td>

                          <td>
                            {entry.time} ms
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  )
}

export default App
