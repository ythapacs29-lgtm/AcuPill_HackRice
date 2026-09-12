import { useRef, useState } from 'react'
import './App.css'

const TILT_THRESHOLD_DEGREES = 30
const RETURN_THRESHOLD_DEGREES = 25
const REST_THRESHOLD_DEGREES = 15
const MOTION_THRESHOLD = 0.12

const MIN_EVENT_DURATION_MS = 1000
const MAX_EVENT_DURATION_MS = 15000
const EVENT_COOLDOWN_MS = 4000

function parseSensorLine(line) {
  const parts = line.trim().split(',')

  // M8 Arduino format:
  // t_ms,touch,ax,ay,az
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
  cosine = Math.max(-1, Math.min(1, cosine))

  return Math.acos(cosine) * (180 / Math.PI)
}

function averageSamples(samples) {
  if (samples.length === 0) {
    return null
  }

  const total = samples.reduce(
    (sum, sample) => {
      return {
        ax: sum.ax + sample.ax,
        ay: sum.ay + sample.ay,
        az: sum.az + sample.az,
      }
    },
    { ax: 0, ay: 0, az: 0 }
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

  const total = numbers.reduce((sum, value) => sum + value, 0)
  return total / numbers.length
}

function standardDeviation(numbers) {
  if (numbers.length === 0) {
    return 0
  }

  const avg = average(numbers)

  const variance =
    numbers.reduce((sum, value) => {
      const difference = value - avg
      return sum + difference * difference
    }, 0) / numbers.length

  return Math.sqrt(variance)
}

function sum(numbers) {
  return numbers.reduce((total, value) => total + value, 0)
}

function App() {
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
  const [eventLog, setEventLog] = useState([])
  const [rejectionLog, setRejectionLog] = useState([])

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
  const eventIdRef = useRef(1)
  const rejectionIdRef = useRef(1)
  const lastEventTimeRef = useRef(-999999)

  function resetCounters() {
    handlingCountRef.current = 0
    tiltCountRef.current = 0
    returnCountRef.current = 0
    idleCountRef.current = 0
  }

  function calculateMotorTelemetry(interaction, endTime) {
    const samples = interaction.samples

    const motionValues = samples.map((sample) => sample.motionAmount)
    const tiltValues = samples.map((sample) => sample.tiltAngleDegrees)

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
          sampleCount: 0,
          maxTiltAngle: 0,
          averageMotion: 0,
          peakMotion: 0,
          motionVariability: 0,
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
    if (eventAlreadyDecidedRef.current) {
      return
    }

    const interaction = currentInteractionRef.current

    if (!interaction) {
      return
    }

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

    const event = {
      id: eventIdRef.current,
      arduinoTime: t_ms,
      clockTime: new Date().toLocaleTimeString(),
      touchSeen: interaction.touchSeen,
      ...telemetry,
    }

    eventIdRef.current += 1
    lastEventTimeRef.current = t_ms
    eventAlreadyDecidedRef.current = true

    setEventLog((oldEvents) => {
      return [event, ...oldEvents].slice(0, 10)
    })
  }

  function changeState(newState, t_ms, context = {}) {
    const oldState = movementStateRef.current

    if (oldState === newState) {
      return
    }

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
      const newEntry = {
        state: newState,
        time: t_ms,
      }

      return [newEntry, ...oldHistory].slice(0, 10)
    })

    console.log('STATE:', newState)
  }

  function calibrateRest() {
    const baseline = averageSamples(recentSamplesRef.current)

    if (!baseline) {
      alert('No samples yet. Connect Arduino first.')
      return
    }

    restBaselineRef.current = baseline
    setRestBaseline(baseline)

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

    const baseline = restBaselineRef.current

    const currentVector = {
      ax,
      ay,
      az,
    }

    const tiltAngleDegrees = angleBetweenVectorsDegrees(
      baseline,
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
      tiltAngleDegrees < REST_THRESHOLD_DEGREES &&
      !isMoving

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
    const timeInCurrentState = t_ms - stateStartedAtRef.current

    // IDLE → HANDLING
    if (currentState === 'IDLE') {
      if (isMoving || tiltAngleDegrees > REST_THRESHOLD_DEGREES) {
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

    // HANDLING → TILTED
    if (currentState === 'HANDLING') {
      if (isTilted) {
        tiltCountRef.current += 1
      } else {
        tiltCountRef.current = 0
      }

      if (timeInCurrentState >= 500 && tiltCountRef.current >= 1) {
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

    // TILTED → RETURNED
    if (currentState === 'TILTED') {
      if (isReturned) {
        returnCountRef.current += 1
      } else {
        returnCountRef.current = 0
      }

      if (timeInCurrentState >= 500 && returnCountRef.current >= 2) {
        changeState('RETURNED', t_ms, {
          touch,
          tiltAngleDegrees,
        })
      }

      return
    }

    // RETURNED → IDLE
    if (currentState === 'RETURNED') {
      if (isAtRest && touch === 0) {
        idleCountRef.current += 1
      } else {
        idleCountRef.current = 0
      }

      if (timeInCurrentState >= 1000 && idleCountRef.current >= 3) {
        changeState('IDLE', t_ms, {
          touch,
          tiltAngleDegrees,
        })
      }

      return
    }
  }

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

        if (done) {
          break
        }

        buffer += value

        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          const cleanLine = line.trim()

          if (!cleanLine) {
            continue
          }

          setLastLine(cleanLine)

          const parsed = parseSensorLine(cleanLine)

          if (!parsed) {
            continue
          }

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
  }

  function clearRejectionLog() {
    setRejectionLog([])
    rejectionIdRef.current = 1
  }

  return (
    <div>
      <h1>AcuPill M8 Motor Telemetry Dashboard</h1>

      <h2>Device Status</h2>
      <p>{connected ? '🟢 CONNECTED' : '🔴 DISCONNECTED'}</p>

      <button onClick={connectArduino} disabled={connected}>
        Connect Arduino
      </button>

      <h2>Incoming Arduino Line</h2>
      <p>{lastLine}</p>

      <h2>Touch Sensor</h2>
      <p
        style={{
          fontSize: '32px',
          fontWeight: 'bold',
        }}
      >
        {sensorData.touch === 1 ? '🟢 TOUCH ACTIVE' : '⚪ NOT TOUCHED'}
      </p>
      <p>Raw touch value: {sensorData.touch}</p>

      <h2>Live Accelerometer Data</h2>
      <p>Time: {sensorData.t_ms} ms</p>
      <p>X: {sensorData.ax}</p>
      <p>Y: {sensorData.ay}</p>
      <p>Z: {sensorData.az}</p>

      <h2>Rest Calibration</h2>
      <p>Rest X: {restBaseline.ax.toFixed(3)}</p>
      <p>Rest Y: {restBaseline.ay.toFixed(3)}</p>
      <p>Rest Z: {restBaseline.az.toFixed(3)}</p>

      <button onClick={calibrateRest} disabled={!connected}>
        Calibrate Rest
      </button>

      <h2>Movement State</h2>
      <p
        style={{
          fontSize: '44px',
          fontWeight: 'bold',
        }}
      >
        {movementState}
      </p>

      <button onClick={resetState}>
        Reset State
      </button>

      <h2>M8 Valid Medication Interaction Log</h2>

      {eventLog.length === 0 ? (
        <p>No valid medication interaction detected yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Status</th>
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
            {eventLog.map((event) => (
              <tr key={event.id}>
                <td>{event.id}</td>
                <td>Possible Medication Interaction</td>
                <td>{event.clockTime}</td>
                <td>{event.durationMs} ms</td>
                <td>{event.touchSeen ? 'YES' : 'NO'}</td>
                <td>{event.maxTiltAngle.toFixed(1)}°</td>
                <td>{event.averageTiltAngle.toFixed(1)}°</td>
                <td>{event.totalMotion.toFixed(3)}</td>
                <td>{event.averageMotion.toFixed(3)}</td>
                <td>{event.peakMotion.toFixed(3)}</td>
                <td>{event.motionVariability.toFixed(3)}</td>
                <td>{event.sampleCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button onClick={clearEventLog} disabled={eventLog.length === 0}>
        Clear Event Log
      </button>

      <h2>Rejected Interaction Log</h2>

      {rejectionLog.length === 0 ? (
        <p>No rejected interactions yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Reason</th>
              <th>Arduino time</th>
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
                <td>{rejection.arduinoTime} ms</td>
                <td>{rejection.durationMs} ms</td>
                <td>{rejection.touchSeen ? 'YES' : 'NO'}</td>
                <td>{rejection.maxTiltAngle.toFixed(1)}°</td>
                <td>{rejection.clockTime}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button
        onClick={clearRejectionLog}
        disabled={rejectionLog.length === 0}
      >
        Clear Rejection Log
      </button>

      <h2>Debug Checks</h2>
      <p>Tilt angle: {debug.tiltAngleDegrees.toFixed(1)}°</p>
      <p>Motion amount: {debug.motionAmount.toFixed(3)}</p>
      <p>Tilted: {debug.isTilted ? 'YES' : 'NO'}</p>
      <p>Moving: {debug.isMoving ? 'YES' : 'NO'}</p>
      <p>At rest: {debug.isAtRest ? 'YES' : 'NO'}</p>
      <p>Cooldown: {debug.cooldownActive ? 'ACTIVE' : 'NO'}</p>

      <h2>State History</h2>

      {stateHistory.length === 0 ? (
        <p>No state changes yet</p>
      ) : (
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
      )}

      <h2>M8 Success Check</h2>
      <p>
        Every valid event should now include duration, max tilt, average tilt,
        total motion, average motion, peak motion, variability, and sample count.
      </p>
    </div>
  )
}

export default App
