import { useRef, useState } from 'react'
import './App.css'

function parseSensorLine(line) {
  const parts = line.trim().split(',')

  // M5 serial format:
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

function App() {
  const [connected, setConnected] = useState(false)
  const [lastLine, setLastLine] = useState('No data yet')
  const [movementState, setMovementState] = useState('IDLE')

  const [sensorData, setSensorData] = useState({
    t_ms: 0,
    touch: 0,
    ax: 0,
    ay: 0,
    az: 0,
  })

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
  })

  const [stateHistory, setStateHistory] = useState([])

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

  function resetCounters() {
    handlingCountRef.current = 0
    tiltCountRef.current = 0
    returnCountRef.current = 0
    idleCountRef.current = 0
  }

  function changeState(newState, t_ms) {
    if (movementStateRef.current === newState) {
      return
    }

    movementStateRef.current = newState
    stateStartedAtRef.current = t_ms
    setMovementState(newState)
    resetCounters()

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
    const { t_ms, ax, ay, az } = data

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

    const isTilted = tiltAngleDegrees > 30

    const isMoving = motionAmount > 0.12

    const isAtRest =
      tiltAngleDegrees < 15 &&
      !isMoving

    const isReturned =
      tiltAngleDegrees < 25

    setDebug({
      tiltAngleDegrees,
      motionAmount,
      isTilted,
      isMoving,
      isAtRest,
    })

    const currentState = movementStateRef.current
    const timeInCurrentState = t_ms - stateStartedAtRef.current

    // IDLE → HANDLING
    if (currentState === 'IDLE') {
      if (isMoving || tiltAngleDegrees > 15) {
        handlingCountRef.current += 1
      } else {
        handlingCountRef.current = 0
      }

      if (handlingCountRef.current >= 2 || isTilted) {
        changeState('HANDLING', t_ms)
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
        changeState('TILTED', t_ms)
      }

      if (isAtRest) {
        idleCountRef.current += 1
      } else {
        idleCountRef.current = 0
      }

      if (idleCountRef.current >= 5) {
        changeState('IDLE', t_ms)
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
        changeState('RETURNED', t_ms)
      }

      return
    }

    // RETURNED → IDLE
    if (currentState === 'RETURNED') {
      if (isAtRest) {
        idleCountRef.current += 1
      } else {
        idleCountRef.current = 0
      }

      if (timeInCurrentState >= 1000 && idleCountRef.current >= 3) {
        changeState('IDLE', t_ms)
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
    resetCounters()
    setMovementState('IDLE')
    setStateHistory([
      {
        state: 'IDLE',
        time: sensorData.t_ms,
      },
    ])
  }

  return (
    <div>
      <h1>AcuPill M5 Dashboard</h1>

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
          fontSize: '36px',
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

      <h2>Debug Checks</h2>
      <p>Tilt angle: {debug.tiltAngleDegrees.toFixed(1)}°</p>
      <p>Motion amount: {debug.motionAmount.toFixed(3)}</p>
      <p>Tilted: {debug.isTilted ? 'YES' : 'NO'}</p>
      <p>Moving: {debug.isMoving ? 'YES' : 'NO'}</p>
      <p>At rest: {debug.isAtRest ? 'YES' : 'NO'}</p>

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

      <h2>M5 Success Check</h2>

      <p>
        Touch should change between NOT TOUCHED and TOUCH ACTIVE while
        X/Y/Z continue updating.
      </p>

      <h2>Next Target</h2>

      <p>
        After M5 passes, move to M6: log one complete medication
        interaction event.
      </p>
    </div>
  )
}

export default App
