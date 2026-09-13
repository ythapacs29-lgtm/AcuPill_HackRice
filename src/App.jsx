import { useEffect, useRef, useState } from 'react'
import './App.css'

const TILT_THRESHOLD_DEGREES = 30
const RETURN_THRESHOLD_DEGREES = 25
const REST_THRESHOLD_DEGREES = 15
const MOTION_THRESHOLD = 0.12

const MIN_EVENT_DURATION_MS = 1000
const MAX_EVENT_DURATION_MS = 15000
const EVENT_COOLDOWN_MS = 4000

const STORAGE_KEY = 'acupill_event_history_v1'

const ROTATING_TERMS = [
  'routine',
  'movement',
  'care',
  'independence',
]

function parseSensorLine(line) {
  const parts = line.trim().split(',')

  if (parts.length !== 5) return null

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

function vectorMagnitude(vector) {
  return Math.sqrt(
    vector.ax * vector.ax +
      vector.ay * vector.ay +
      vector.az * vector.az
  )
}

function angleBetweenVectorsDegrees(a, b) {
  const dot = a.ax * b.ax + a.ay * b.ay + a.az * b.az

  const magA = vectorMagnitude(a)
  const magB = vectorMagnitude(b)

  if (magA === 0 || magB === 0) return 0

  let cosine = dot / (magA * magB)
  cosine = Math.max(-1, Math.min(1, cosine))

  return Math.acos(cosine) * (180 / Math.PI)
}

function averageSamples(samples) {
  if (samples.length === 0) return null

  const total = samples.reduce(
    (sum, sample) => ({
      ax: sum.ax + sample.ax,
      ay: sum.ay + sample.ay,
      az: sum.az + sample.az,
    }),
    { ax: 0, ay: 0, az: 0 }
  )

  return {
    ax: total.ax / samples.length,
    ay: total.ay / samples.length,
    az: total.az / samples.length,
  }
}

function average(numbers) {
  if (numbers.length === 0) return 0

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
}

function sum(numbers) {
  return numbers.reduce((total, value) => total + value, 0)
}

function standardDeviation(numbers) {
  if (numbers.length === 0) return 0

  const avg = average(numbers)

  const variance =
    numbers.reduce((total, value) => {
      const difference = value - avg
      return total + difference * difference
    }, 0) / numbers.length

  return Math.sqrt(variance)
}

function loadSavedEvents() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)

    if (!saved) return []

    const parsed = JSON.parse(saved)

    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('Could not load saved events:', error)
    return []
  }
}

function saveEvents(events) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events))
  } catch (error) {
    console.error('Could not save events:', error)
  }
}

function calculateBaseline(events) {
  if (events.length === 0) return null

  return {
    count: events.length,

    durationMs: average(
      events.map((event) => event.durationMs || 0)
    ),

    maxTiltAngle: average(
      events.map((event) => event.maxTiltAngle || 0)
    ),

    totalMotion: average(
      events.map((event) => event.totalMotion || 0)
    ),

    averageMotion: average(
      events.map((event) => event.averageMotion || 0)
    ),

    peakMotion: average(
      events.map((event) => event.peakMotion || 0)
    ),

    motionVariability: average(
      events.map((event) => event.motionVariability || 0)
    ),
  }
}

function percentChange(latestValue, baselineValue) {
  if (baselineValue === 0) return 0

  return ((latestValue - baselineValue) / baselineValue) * 100
}

function formatPercent(value) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return '—'

  return value.toFixed(digits)
}

function formatMs(value) {
  if (!Number.isFinite(value)) return '—'

  return `${value} ms`
}

function LogoMark() {
  return (
    <div className="logo-lockup">
      <div className="logo-icon" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="46" height="46">
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
        <p className="eyebrow">Medication support between appointments</p>

        <h1 className="brand-title">
          <span>Acu</span>
          <span className="brand-accent">Pill</span>
        </h1>
      </div>
    </div>
  )
}

function MetricCard({ label, value, subtext }) {
  return (
    <div className="metric-card">
      <p className="metric-label">{label}</p>

      <p key={String(value)} className="metric-value tick">
        {value}
      </p>

      {subtext ? <p className="metric-subtext">{subtext}</p> : null}
    </div>
  )
}

function App() {
  /* =========================================================
     ROLE / LOGIN STATE
     ========================================================= */

  const [session, setSession] = useState(null)
  const [loginRole, setLoginRole] = useState('patient')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  /* =========================================================
     DEVICE STATE
     ========================================================= */

  const [connected, setConnected] = useState(false)
  const [lastLine, setLastLine] = useState('No data yet')

  const [sensorData, setSensorData] = useState({
    t_ms: 0,
    touch: 0,
    ax: 0,
    ay: 0,
    az: 0,
  })

  const [movementState, setMovementState] = useState('IDLE')

  const [restBaseline, setRestBaseline] = useState({
    ax: 0,
    ay: 1,
    az: 0,
  })

  const [debug, setDebug] = useState({
    tiltAngleDegrees: 0,
    motionAmount: 0,
    isTilted: false,
    isMoving: false,
    isAtRest: false,
    cooldownActive: false,
  })

  const [stateHistory, setStateHistory] = useState([])
  const [eventLog, setEventLog] = useState(() => loadSavedEvents())
  const [rejectionLog, setRejectionLog] = useState([])
  const [rotatingTermIndex, setRotatingTermIndex] = useState(0)

  /* =========================================================
     REFS
     ========================================================= */

  const restBaselineRef = useRef({
    ax: 0,
    ay: 1,
    az: 0,
  })

  const recentSamplesRef = useRef([])
  const previousDataRef = useRef(null)

  const movementStateRef = useRef('IDLE')
  const stateStartedAtRef = useRef(0)

  const handlingCountRef = useRef(0)
  const tiltCountRef = useRef(0)
  const returnCountRef = useRef(0)
  const idleCountRef = useRef(0)

  const currentInteractionRef = useRef(null)
  const eventAlreadyDecidedRef = useRef(false)

  const eventIdRef = useRef(
    eventLog.length > 0
      ? Math.max(...eventLog.map((event) => Number(event.id) || 0)) + 1
      : 1
  )

  const rejectionIdRef = useRef(1)
  const lastEventTimeRef = useRef(-999999)

  /* =========================================================
     EFFECTS
     ========================================================= */

  useEffect(() => {
    saveEvents(eventLog)
  }, [eventLog])

  useEffect(() => {
    const interval = setInterval(() => {
      setRotatingTermIndex(
        (previous) => (previous + 1) % ROTATING_TERMS.length
      )
    }, 2300)

    return () => clearInterval(interval)
  }, [])

  /* =========================================================
     ANALYTICS
     ========================================================= */

  const latestEvent = eventLog[0] || null
  const baselineEvents = eventLog.slice(1)
  const baseline = calculateBaseline(baselineEvents)

  const todayDate = new Date().toLocaleDateString()

  const todayEvents = eventLog.filter(
    (event) => event.recordedDate === todayDate
  )

  let durationChange = 0
  let motionChange = 0
  let variabilityChange = 0

  let baselineInsight =
    'Collect more valid interactions to build a personal baseline.'

  let insightTone = 'neutral'

  if (latestEvent && baseline && baseline.count >= 3) {
    durationChange = percentChange(
      latestEvent.durationMs,
      baseline.durationMs
    )

    motionChange = percentChange(
      latestEvent.totalMotion,
      baseline.totalMotion
    )

    variabilityChange = percentChange(
      latestEvent.motionVariability,
      baseline.motionVariability
    )

    if (durationChange > 25) {
      baselineInsight =
        'Latest interaction was slower than the personal baseline.'

      insightTone = 'warning'
    } else if (motionChange > 25 || variabilityChange > 25) {
      baselineInsight =
        'Latest interaction showed more movement variation than baseline.'

      insightTone = 'warning'
    } else if (durationChange < -25) {
      baselineInsight =
        'Latest interaction was faster than the personal baseline.'

      insightTone = 'info'
    } else {
      baselineInsight =
        'Latest interaction looks close to the personal baseline.'

      insightTone = 'good'
    }
  }

  let patientMovementStatus =
    'Building your recent movement pattern.'

  if (latestEvent && baseline && baseline.count >= 3) {
    const variabilityDifference = Math.abs(
      percentChange(
        latestEvent.motionVariability,
        baseline.motionVariability
      )
    )

    const motionDifference = Math.abs(
      percentChange(
        latestEvent.totalMotion,
        baseline.totalMotion
      )
    )

    if (variabilityDifference > 25 || motionDifference > 30) {
      patientMovementStatus =
        'Your recent movement pattern has been a little different from usual.'
    } else {
      patientMovementStatus =
        'Your recent movement pattern looks similar to your usual pattern.'
    }
  }

  const rotatingTerm = ROTATING_TERMS[rotatingTermIndex]

  /* =========================================================
     LOGIN
     ========================================================= */

  function handleLogin(event) {
    event.preventDefault()

    /*
      DEMO AUTHENTICATION ONLY.

      We intentionally do NOT store email/password.

      Later:
      - real authentication
      - backend
      - Tiger Data
    */

    setSession(loginRole)
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

  function calculateMotorTelemetry(interaction, endTime) {
    const samples = interaction.samples

    const motionValues = samples.map(
      (sample) => sample.motionAmount
    )

    const tiltValues = samples.map(
      (sample) => sample.tiltAngleDegrees
    )

    const durationMs = endTime - interaction.startTime

    return {
      durationMs,
      sampleCount: samples.length,

      maxTiltAngle: Math.max(...tiltValues, 0),

      averageTiltAngle: average(tiltValues),

      totalMotion: sum(motionValues),

      averageMotion: average(motionValues),

      peakMotion: Math.max(...motionValues, 0),

      motionVariability: standardDeviation(motionValues),
    }
  }

  function addRejectedInteraction(t_ms, reason, interaction) {
    const telemetry = interaction
      ? calculateMotorTelemetry(interaction, t_ms)
      : {
          durationMs: 0,
          maxTiltAngle: 0,
        }

    const rejection = {
      id: rejectionIdRef.current,

      arduinoTime: t_ms,

      reason,

      durationMs: telemetry.durationMs,

      touchSeen: interaction ? interaction.touchSeen : false,

      maxTiltAngle: telemetry.maxTiltAngle,

      clockTime: new Date().toLocaleTimeString(),
    }

    rejectionIdRef.current += 1

    setRejectionLog((oldRejections) => {
      return [rejection, ...oldRejections].slice(0, 8)
    })
  }

  function tryLogMedicationInteraction(t_ms) {
    if (eventAlreadyDecidedRef.current) return

    const interaction = currentInteractionRef.current

    if (!interaction) return

    const telemetry = calculateMotorTelemetry(interaction, t_ms)

    const cooldownActive =
      t_ms - lastEventTimeRef.current < EVENT_COOLDOWN_MS

    if (cooldownActive) {
      eventAlreadyDecidedRef.current = true

      addRejectedInteraction(
        t_ms,
        'Rejected: cooldown active',
        interaction
      )

      return
    }

    if (!interaction.touchSeen) {
      eventAlreadyDecidedRef.current = true

      addRejectedInteraction(
        t_ms,
        'Rejected: no touch detected',
        interaction
      )

      return
    }

    if (telemetry.maxTiltAngle < TILT_THRESHOLD_DEGREES) {
      eventAlreadyDecidedRef.current = true

      addRejectedInteraction(
        t_ms,
        'Rejected: tilt too small',
        interaction
      )

      return
    }

    if (telemetry.durationMs < MIN_EVENT_DURATION_MS) {
      eventAlreadyDecidedRef.current = true

      addRejectedInteraction(
        t_ms,
        'Rejected: too fast',
        interaction
      )

      return
    }

    if (telemetry.durationMs > MAX_EVENT_DURATION_MS) {
      eventAlreadyDecidedRef.current = true

      addRejectedInteraction(
        t_ms,
        'Rejected: too long',
        interaction
      )

      return
    }

    const now = new Date()

    const event = {
      id: eventIdRef.current,

      arduinoTime: t_ms,

      recordedAtISO: now.toISOString(),

      recordedDate: now.toLocaleDateString(),

      clockTime: now.toLocaleTimeString(),

      touchSeen: interaction.touchSeen,

      ...telemetry,
    }

    eventIdRef.current += 1

    lastEventTimeRef.current = t_ms

    eventAlreadyDecidedRef.current = true

    setEventLog((oldEvents) => {
      return [event, ...oldEvents].slice(0, 20)
    })
  }

  function changeState(newState, t_ms, context = {}) {
    const oldState = movementStateRef.current

    if (oldState === newState) return

    movementStateRef.current = newState
    stateStartedAtRef.current = t_ms

    setMovementState(newState)

    resetCounters()

    if (oldState === 'IDLE' && newState === 'HANDLING') {
      currentInteractionRef.current = {
        startTime: t_ms,
        touchSeen: context.touch === 1,
        samples: [],
      }

      eventAlreadyDecidedRef.current = false
    }

    if (oldState === 'TILTED' && newState === 'RETURNED') {
      tryLogMedicationInteraction(t_ms)
    }

    if (oldState === 'RETURNED' && newState === 'IDLE') {
      currentInteractionRef.current = null
      eventAlreadyDecidedRef.current = false
    }

    setStateHistory((oldHistory) => {
      return [
        {
          state: newState,
          time: t_ms,
        },
        ...oldHistory,
      ].slice(0, 10)
    })
  }

  function calibrateRest() {
    const newBaseline = averageSamples(recentSamplesRef.current)

    if (!newBaseline) {
      alert('No samples yet. Connect Arduino first.')
      return
    }

    restBaselineRef.current = newBaseline
    setRestBaseline(newBaseline)

    movementStateRef.current = 'IDLE'
    stateStartedAtRef.current = sensorData.t_ms

    previousDataRef.current = null
    currentInteractionRef.current = null
    eventAlreadyDecidedRef.current = false

    resetCounters()

    setMovementState('IDLE')

    setStateHistory([
      {
        state: 'IDLE',
        time: sensorData.t_ms,
      },
    ])
  }

  function updateMovementState(data) {
    const { t_ms, touch, ax, ay, az } = data

    const currentVector = {
      ax,
      ay,
      az,
    }

    const tiltAngleDegrees = angleBetweenVectorsDegrees(
      restBaselineRef.current,
      currentVector
    )

    const previousData = previousDataRef.current

    let motionAmount = 0

    if (previousData) {
      motionAmount =
        Math.abs(ax - previousData.ax) +
        Math.abs(ay - previousData.ay) +
        Math.abs(az - previousData.az)
    }

    previousDataRef.current = data

    const isTilted =
      tiltAngleDegrees > TILT_THRESHOLD_DEGREES

    const isMoving =
      motionAmount > MOTION_THRESHOLD

    const isAtRest =
      tiltAngleDegrees < REST_THRESHOLD_DEGREES && !isMoving

    const isReturned =
      tiltAngleDegrees < RETURN_THRESHOLD_DEGREES

    const cooldownActive =
      t_ms - lastEventTimeRef.current < EVENT_COOLDOWN_MS

    if (currentInteractionRef.current) {
      if (touch === 1) {
        currentInteractionRef.current.touchSeen = true
      }

      currentInteractionRef.current.samples.push({
        t_ms,
        touch,
        ax,
        ay,
        az,
        tiltAngleDegrees,
        motionAmount,
      })
    }

    setDebug({
      tiltAngleDegrees,
      motionAmount,
      isTilted,
      isMoving,
      isAtRest,
      cooldownActive,
    })

    const currentState = movementStateRef.current

    const timeInCurrentState =
      t_ms - stateStartedAtRef.current

    if (currentState === 'IDLE') {
      if (
        isMoving ||
        tiltAngleDegrees > REST_THRESHOLD_DEGREES
      ) {
        handlingCountRef.current += 1
      } else {
        handlingCountRef.current = 0
      }

      if (handlingCountRef.current >= 2 || isTilted) {
        changeState('HANDLING', t_ms, {
          touch,
          tiltAngleDegrees,
        })
      }

      return
    }

    if (currentState === 'HANDLING') {
      if (isTilted) {
        tiltCountRef.current += 1
      } else {
        tiltCountRef.current = 0
      }

      if (
        timeInCurrentState >= 500 &&
        tiltCountRef.current >= 1
      ) {
        changeState('TILTED', t_ms, {
          touch,
          tiltAngleDegrees,
        })
      }

      if (isAtRest && touch === 0) {
        idleCountRef.current += 1
      } else {
        idleCountRef.current = 0
      }

      if (idleCountRef.current >= 5) {
        changeState('IDLE', t_ms, {
          touch,
          tiltAngleDegrees,
        })
      }

      return
    }

    if (currentState === 'TILTED') {
      if (isReturned) {
        returnCountRef.current += 1
      } else {
        returnCountRef.current = 0
      }

      if (
        timeInCurrentState >= 500 &&
        returnCountRef.current >= 2
      ) {
        changeState('RETURNED', t_ms, {
          touch,
          tiltAngleDegrees,
        })
      }

      return
    }

    if (currentState === 'RETURNED') {
      if (isAtRest && touch === 0) {
        idleCountRef.current += 1
      } else {
        idleCountRef.current = 0
      }

      if (
        timeInCurrentState >= 1000 &&
        idleCountRef.current >= 3
      ) {
        changeState('IDLE', t_ms, {
          touch,
          tiltAngleDegrees,
        })
      }
    }
  }

  /* =========================================================
     ARDUINO CONNECTION
     ========================================================= */

  async function connectArduino() {
    if (!('serial' in navigator)) {
      alert('Web Serial is not supported. Please use Google Chrome.')
      return
    }

    try {
      const port = await navigator.serial.requestPort()

      await port.open({
        baudRate: 115200,
      })

      setConnected(true)

      const decoder = new TextDecoderStream()

      port.readable.pipeTo(decoder.writable)

      const reader = decoder.readable.getReader()

      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()

        if (done) break

        buffer += value

        const lines = buffer.split('\n')

        buffer = lines.pop()

        for (const line of lines) {
          const cleanLine = line.trim()

          if (!cleanLine) continue

          setLastLine(cleanLine)

          const parsed = parseSensorLine(cleanLine)

          if (!parsed) continue

          setSensorData(parsed)

          recentSamplesRef.current = [
            ...recentSamplesRef.current,
            parsed,
          ].slice(-12)

          updateMovementState(parsed)
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
    movementStateRef.current = 'IDLE'

    stateStartedAtRef.current = sensorData.t_ms

    previousDataRef.current = null
    currentInteractionRef.current = null
    eventAlreadyDecidedRef.current = false

    resetCounters()

    setMovementState('IDLE')

    setStateHistory([
      {
        state: 'IDLE',
        time: sensorData.t_ms,
      },
    ])
  }

  function clearEventLog() {
    setEventLog([])

    eventIdRef.current = 1
    lastEventTimeRef.current = -999999

    localStorage.removeItem(STORAGE_KEY)
  }

  function clearRejectionLog() {
    setRejectionLog([])
    rejectionIdRef.current = 1
  }

  /* =========================================================
     LOGIN SCREEN
     ========================================================= */

  if (!session) {
    return (
      <div className="login-page">
        <div className="login-brand-panel">
          <LogoMark />

          <div className="login-message">
            <p className="login-kicker">Care between appointments</p>

            <h2>
              Medication support built around{' '}
              <span className="rotating-login-word" key={rotatingTerm}>
                {rotatingTerm}
              </span>
              .
            </h2>

            <p>
              AcuPill helps patients maintain their medication routine
              while preserving meaningful movement and interaction history
              for caregivers and clinicians.
            </p>
          </div>

          <div className="login-trust-row">
            <span>Medication routine</span>
            <span>Movement history</span>
            <span>Appointment memory</span>
          </div>
        </div>

        <div className="login-form-panel">
          <div className="login-box">
            <p className="eyebrow">Welcome to AcuPill</p>

            <h2 className="login-heading">Sign in</h2>

            <p className="login-description">
              Choose how you use AcuPill.
            </p>

            <div className="role-selector">
              <button
                type="button"
                className={
                  loginRole === 'patient'
                    ? 'role-option active'
                    : 'role-option'
                }
                onClick={() => setLoginRole('patient')}
              >
                <span className="role-icon">P</span>

                <span>
                  <strong>Patient</strong>
                  <small>My routine & support</small>
                </span>
              </button>

              <button
                type="button"
                className={
                  loginRole === 'caregiver'
                    ? 'role-option active'
                    : 'role-option'
                }
                onClick={() => setLoginRole('caregiver')}
              >
                <span className="role-icon">C</span>

                <span>
                  <strong>Care Team / Clinic</strong>
                  <small>Patient trends & insights</small>
                </span>
              </button>
            </div>

            <form onSubmit={handleLogin} className="login-form">
              <label>
                Email
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(event) =>
                    setLoginEmail(event.target.value)
                  }
                  placeholder={
                    loginRole === 'patient'
                      ? 'patient@example.com'
                      : 'clinician@clinic.com'
                  }
                  autoComplete="email"
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) =>
                    setLoginPassword(event.target.value)
                  }
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </label>

              <button className="login-submit" type="submit">
                {loginRole === 'patient'
                  ? 'Continue to my dashboard'
                  : 'Continue to care dashboard'}
              </button>
            </form>

            <p className="demo-note">
              Demo mode — authentication will be connected to the backend
              later.
            </p>

            <div className="engineering-access">
              <button
                type="button"
                onClick={() => setSession('engineering')}
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
     LOGGED-IN APP HEADER
     ========================================================= */

  return (
    <div className="app-shell">
      <header className="app-header">
        <LogoMark />

        <div className="app-header-right">
          {session === 'patient' && (
            <span className="role-badge">Patient</span>
          )}

          {session === 'caregiver' && (
            <span className="role-badge">Care Team / Clinic</span>
          )}

          {session === 'engineering' && (
            <span className="role-badge engineering-badge">
              Engineering
            </span>
          )}

          {session === 'engineering' && (
            <div
              className={
                connected ? 'status-pill good' : 'status-pill bad'
              }
            >
              <span className="pulse-dot"></span>

              {connected ? 'Connected' : 'Disconnected'}
            </div>
          )}

          <button className="signout-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {/* =====================================================
          PATIENT DASHBOARD
          ===================================================== */}

      {session === 'patient' && (
        <main className="dashboard-view patient-view">
          <section className="patient-welcome">
            <p className="eyebrow">Patient support</p>

            <h2 className="patient-title">
              Your medication routine
            </h2>

            <p className="patient-intro">
              AcuPill helps keep track of medication-bottle
              interactions and remembers important changes between
              appointments.
            </p>
          </section>

          <section className="patient-grid">
            <div className="patient-feature">
              <p className="card-label">Next medication</p>

              <p className="patient-big-value">
                Schedule setup
              </p>

              <p className="patient-helper">
                Medication scheduling is the next feature we will add.
              </p>
            </div>

            <div className="patient-feature">
              <p className="card-label">Today's routine</p>

              <p className="patient-big-value">
                {todayEvents.length}
              </p>

              <p className="patient-helper">
                {todayEvents.length === 1
                  ? 'bottle interaction recorded today'
                  : 'bottle interactions recorded today'}
              </p>
            </div>

            <div className="patient-feature">
              <p className="card-label">Movement</p>

              <p className="patient-status-text">
                {patientMovementStatus}
              </p>
            </div>
          </section>

          <section className="patient-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Recent activity</p>
                <h2>Bottle interactions</h2>
              </div>
            </div>

            {todayEvents.length === 0 ? (
              <div className="patient-message">
                <strong>
                  No medication-bottle interaction has been recorded
                  today.
                </strong>

                <p>
                  AcuPill records bottle handling rather than medication
                  ingestion.
                </p>
              </div>
            ) : (
              <div className="patient-routine-list">
                {todayEvents.slice(0, 5).map((event) => (
                  <div
                    key={event.id}
                    className="patient-routine-row"
                  >
                    <div>
                      <strong>Bottle interaction recorded</strong>
                      <p>{event.clockTime}</p>
                    </div>

                    <span className="routine-confirmed">
                      Recorded
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="patient-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Appointment memory</p>
                <h2>Major changes</h2>
              </div>
            </div>

            <div className="patient-message">
              <strong>No major changes have been saved yet.</strong>

              <p>
                AcuPill will quietly watch for repeated changes and save
                meaningful dates for your next appointment.
              </p>
            </div>
          </section>

          <section className="patient-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Check-in</p>

                <h2>
                  How did handling your medication feel today?
                </h2>
              </div>
            </div>

            <div className="checkin-options">
              <button className="checkin-button">Easy</button>

              <button className="checkin-button">
                A little difficult
              </button>

              <button className="checkin-button">
                Difficult
              </button>
            </div>
          </section>
        </main>
      )}

      {/* =====================================================
          CAREGIVER / CLINICIAN DASHBOARD
          ===================================================== */}

      {session === 'caregiver' && (
        <main className="dashboard-view">
          <section className="caregiver-summary">
            <div>
              <p className="eyebrow">Caregiver / clinician</p>

              <h2 className="caregiver-title">
                Patient overview
              </h2>

              <p className="patient-intro">
                Review medication interaction history and changes in
                handling patterns over time.
              </p>
            </div>

            <div
              className={`caregiver-callout ${insightTone}`}
            >
              <p className="card-label">Current insight</p>

              <strong>{baselineInsight}</strong>

              <p className="tiny-text">
                Experimental comparison only. Not a medical diagnosis.
              </p>
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Latest result</p>
                <h2>Medication interaction</h2>
              </div>
            </div>

            {latestEvent ? (
              <div className="metric-grid">
                <MetricCard
                  label="Status"
                  value="Detected"
                  subtext="Possible medication interaction"
                />

                <MetricCard
                  label="Duration"
                  value={formatMs(latestEvent.durationMs)}
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
                  label="Touch seen"
                  value={latestEvent.touchSeen ? 'Yes' : 'No'}
                />
              </div>
            ) : (
              <div className="empty-card">
                No medication interaction has been detected yet.
              </div>
            )}
          </section>

          <section className="section-block two-column">
            <div>
              <p className="eyebrow">Personal baseline</p>
              <h2>Normal handling pattern</h2>

              {baseline ? (
                <div className="mini-grid">
                  <MetricCard
                    label="Events"
                    value={baseline.count}
                  />

                  <MetricCard
                    label="Avg duration"
                    value={`${baseline.durationMs.toFixed(0)} ms`}
                  />

                  <MetricCard
                    label="Avg max tilt"
                    value={`${baseline.maxTiltAngle.toFixed(1)}°`}
                  />

                  <MetricCard
                    label="Avg motion"
                    value={baseline.totalMotion.toFixed(3)}
                  />

                  <MetricCard
                    label="Avg variability"
                    value={baseline.motionVariability.toFixed(3)}
                  />
                </div>
              ) : (
                <p>
                  No baseline yet. Complete several valid interactions.
                </p>
              )}
            </div>

            <div>
              <p className="eyebrow">Comparison</p>
              <h2>Latest vs baseline</h2>

              {latestEvent && baseline && baseline.count >= 3 ? (
                <div className="comparison-list">
                  <p>
                    Duration change
                    <strong>{formatPercent(durationChange)}</strong>
                  </p>

                  <p>
                    Total motion change
                    <strong>{formatPercent(motionChange)}</strong>
                  </p>

                  <p>
                    Variability change
                    <strong>
                      {formatPercent(variabilityChange)}
                    </strong>
                  </p>
                </div>
              ) : (
                <p>
                  At least four valid events are needed before baseline
                  comparison is available.
                </p>
              )}
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Longitudinal record</p>
                <h2>Interaction history</h2>
              </div>

              <button
                className="danger-button"
                onClick={clearEventLog}
                disabled={eventLog.length === 0}
              >
                Clear history
              </button>
            </div>

            {eventLog.length === 0 ? (
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
                      <th>Touch</th>
                      <th>Max tilt</th>
                      <th>Avg tilt</th>
                      <th>Total motion</th>
                      <th>Avg motion</th>
                      <th>Peak motion</th>
                      <th>Variability</th>
                      <th>Samples</th>
                    </tr>
                  </thead>

                  <tbody>
                    {eventLog.map((event, index) => (
                      <tr
                        key={event.id}
                        className={index === 0 ? 'fresh' : ''}
                      >
                        <td>{event.id}</td>

                        <td>
                          {event.recordedDate || 'Older event'}
                        </td>

                        <td>{event.clockTime}</td>

                        <td>{formatMs(event.durationMs)}</td>

                        <td>{event.touchSeen ? 'Yes' : 'No'}</td>

                        <td>
                          {formatNumber(event.maxTiltAngle, 1)}°
                        </td>

                        <td>
                          {formatNumber(event.averageTiltAngle, 1)}°
                        </td>

                        <td>
                          {formatNumber(event.totalMotion, 3)}
                        </td>

                        <td>
                          {formatNumber(event.averageMotion, 3)}
                        </td>

                        <td>
                          {formatNumber(event.peakMotion, 3)}
                        </td>

                        <td>
                          {formatNumber(
                            event.motionVariability,
                            3
                          )}
                        </td>

                        <td>{event.sampleCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Major change timeline</p>
                <h2>Appointment Memory</h2>
              </div>
            </div>

            <div className="empty-card">
              Repeated-change detection will be added in a later step.
            </div>
          </section>
        </main>
      )}

      {/* =====================================================
          ENGINEERING DASHBOARD
          ===================================================== */}

      {session === 'engineering' && (
        <main className="dashboard-view">
          <section className="engineering-header">
            <p className="eyebrow">Engineering</p>

            <h2 className="caregiver-title">
              Device & detection diagnostics
            </h2>

            <p>
              Raw sensor information and detector controls are kept
              separate from the patient experience.
            </p>
          </section>

          <section className="engineering-top-grid">
            <div className="engineering-feature">
              <p className="card-label">Device</p>

              <h2>
                {connected ? 'Arduino online' : 'Waiting for Arduino'}
              </h2>

              <button
                className="primary-button"
                onClick={connectArduino}
                disabled={connected}
              >
                Connect Arduino
              </button>

              <p className="tiny-text">
                Expected stream: t_ms,touch,ax,ay,az
              </p>
            </div>

            <div className="engineering-feature">
              <p className="card-label">Touch sensor</p>

              <h2
                key={sensorData.touch}
                className={
                  sensorData.touch === 1
                    ? 'touch-active tick'
                    : 'touch-idle tick'
                }
              >
                {sensorData.touch === 1
                  ? 'Touch active'
                  : 'Not touched'}
              </h2>

              <p className="tiny-text">
                Raw touch: {sensorData.touch}
              </p>
            </div>

            <div className="engineering-feature">
              <p className="card-label">Movement state</p>

              <h2
                key={movementState}
                className="state-text tick"
              >
                {movementState}
              </h2>

              <button
                className="secondary-button"
                onClick={resetState}
              >
                Reset state
              </button>
            </div>
          </section>

          <section className="section-block">
            <div className="debug-grid">
              <div className="engineering-feature">
                <h3>Live serial</h3>

                <p className="mono">{lastLine}</p>

                <p>Time: {sensorData.t_ms} ms</p>
                <p>X: {sensorData.ax}</p>
                <p>Y: {sensorData.ay}</p>
                <p>Z: {sensorData.az}</p>
              </div>

              <div className="engineering-feature">
                <h3>Rest calibration</h3>

                <p>Rest X: {restBaseline.ax.toFixed(3)}</p>
                <p>Rest Y: {restBaseline.ay.toFixed(3)}</p>
                <p>Rest Z: {restBaseline.az.toFixed(3)}</p>

                <button
                  className="secondary-button"
                  onClick={calibrateRest}
                  disabled={!connected}
                >
                  Calibrate rest
                </button>
              </div>

              <div className="engineering-feature">
                <h3>Detection checks</h3>

                <p>
                  Tilt angle: {debug.tiltAngleDegrees.toFixed(1)}°
                </p>

                <p>Motion: {debug.motionAmount.toFixed(3)}</p>

                <p>Tilted: {debug.isTilted ? 'Yes' : 'No'}</p>

                <p>Moving: {debug.isMoving ? 'Yes' : 'No'}</p>

                <p>At rest: {debug.isAtRest ? 'Yes' : 'No'}</p>

                <p>
                  Cooldown: {debug.cooldownActive ? 'Active' : 'No'}
                </p>
              </div>
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Detector</p>

                <h2>Rejected interactions</h2>
              </div>
            </div>

            {rejectionLog.length === 0 ? (
              <div className="empty-card">
                No rejected interactions yet.
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
                      <th>Clock time</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rejectionLog.map((rejection) => (
                      <tr key={rejection.id}>
                        <td>{rejection.id}</td>
                        <td>{rejection.reason}</td>

                        <td>{formatMs(rejection.durationMs)}</td>

                        <td>
                          {rejection.touchSeen ? 'Yes' : 'No'}
                        </td>

                        <td>
                          {formatNumber(rejection.maxTiltAngle, 1)}°
                        </td>

                        <td>{rejection.clockTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button
              className="secondary-button"
              onClick={clearRejectionLog}
              disabled={rejectionLog.length === 0}
            >
              Clear rejections
            </button>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">State machine</p>
                <h2>State history</h2>
              </div>
            </div>

            {stateHistory.length === 0 ? (
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
                    {stateHistory.map((entry, index) => (
                      <tr key={index}>
                        <td>{entry.state}</td>
                        <td>{entry.time} ms</td>
                      </tr>
                    ))}
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
