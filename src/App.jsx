import { useRef, useState } from 'react'
import './App.css'

import { parseSensorLine } from './utils/parseSensorLine'
import {
  createM4Machine,
  updateM4Machine,
} from './utils/m4StateMachine'

function App() {
  // -----------------------------------
  // CONNECTION
  // -----------------------------------

  const [connected, setConnected] =
    useState(false)

  // -----------------------------------
  // SENSOR DATA
  // -----------------------------------

  const [sensorData, setSensorData] =
    useState({
      t_ms: 0,
      ax: 0,
      ay: 0,
      az: 0,
    })

  const [lastLine, setLastLine] =
    useState('No data yet')

  // -----------------------------------
  // M4 STATE MACHINE
  // -----------------------------------

  const machineRef =
    useRef(createM4Machine())

  const [movementState, setMovementState] =
    useState('IDLE')

  const [debug, setDebug] =
    useState(
      machineRef.current.debug
    )

  const [stateHistory, setStateHistory] =
    useState([])

  // -----------------------------------
  // PROCESS ONE SENSOR SAMPLE
  // -----------------------------------

  function processSensorData(data) {
    setSensorData(data)

    const nextMachine =
      updateM4Machine(
        machineRef.current,
        data
      )

    machineRef.current =
      nextMachine

    setMovementState(
      nextMachine.state
    )

    setDebug(
      nextMachine.debug
    )

    setStateHistory(
      nextMachine.history
    )
  }

  // -----------------------------------
  // CONNECT TO ARDUINO
  // -----------------------------------

  async function connectArduino() {
    if (!('serial' in navigator)) {
      alert(
        'Web Serial is not supported. Use Google Chrome.'
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

      port.readable
        .pipeTo(decoder.writable)
        .catch(() => {})

      const reader =
        decoder.readable.getReader()

      let buffer = ''

      while (true) {
        const {
          value,
          done,
        } = await reader.read()

        if (done) {
          break
        }

        buffer += value

        const lines =
          buffer.split('\n')

        // Keep unfinished line
        buffer = lines.pop()

        for (const line of lines) {
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

          if (parsed) {
            processSensorData(
              parsed
            )
          }
        }
      }

      setConnected(false)

    } catch (error) {
      console.error(error)

      setConnected(false)

      alert(
        'Could not connect to Arduino. Check USB and try again.'
      )
    }
  }

  // -----------------------------------
  // RESET M4
  // -----------------------------------

  function resetState() {
    const freshMachine =
      createM4Machine()

    freshMachine.stateStartedAt =
      sensorData.t_ms

    machineRef.current =
      freshMachine

    setMovementState(
      'IDLE'
    )

    setDebug(
      freshMachine.debug
    )

    setStateHistory([])
  }

  return (
    <div className="app">

      <header className="header">
        <h1>AcuPill</h1>

        <p>
          Smart medication interaction prototype
        </p>
      </header>

      <section className="card">

        <h2>Device Status</h2>

        <div
          className={
            connected
              ? 'status connected'
              : 'status disconnected'
          }
        >
          {connected
            ? '● CONNECTED'
            : '● DISCONNECTED'}
        </div>

        <button
          onClick={connectArduino}
          disabled={connected}
        >
          Connect Arduino
        </button>

      </section>

      <section className="card">

        <h2>Incoming Arduino Line</h2>

        <code className="serial-line">
          {lastLine}
        </code>

      </section>

      <section className="card">

        <h2>Live Accelerometer</h2>

        <div className="sensor-grid">

          <div>
            <span>Time</span>
            <strong>
              {sensorData.t_ms} ms
            </strong>
          </div>

          <div>
            <span>X</span>
            <strong>
              {sensorData.ax}
            </strong>
          </div>

          <div>
            <span>Y</span>
            <strong>
              {sensorData.ay}
            </strong>
          </div>

          <div>
            <span>Z</span>
            <strong>
              {sensorData.az}
            </strong>
          </div>

        </div>

      </section>

      <section className="card">

        <h2>Current State</h2>

        <div className="current-state">
          {movementState}
        </div>

        <button
          onClick={resetState}
        >
          Reset State
        </button>

        <p className="target">
          IDLE → HANDLING → TILTED
          → RETURNED → IDLE
        </p>

      </section>

      <section className="card">

        <h2>M4 Debug</h2>

        <div className="debug-grid">

          <p>
            Motion:
            {' '}
            <strong>
              {debug.motionAmount.toFixed(3)}
            </strong>
          </p>

          <p>
            Moving:
            {' '}
            <strong>
              {debug.isMoving
                ? 'YES'
                : 'NO'}
            </strong>
          </p>

          <p>
            Idle:
            {' '}
            <strong>
              {debug.isIdle
                ? 'YES'
                : 'NO'}
            </strong>
          </p>

          <p>
            Handling:
            {' '}
            <strong>
              {debug.isHandling
                ? 'YES'
                : 'NO'}
            </strong>
          </p>

          <p>
            Tilted:
            {' '}
            <strong>
              {debug.isTilted
                ? 'YES'
                : 'NO'}
            </strong>
          </p>

          <p>
            Returned:
            {' '}
            <strong>
              {debug.isReturned
                ? 'YES'
                : 'NO'}
            </strong>
          </p>

        </div>

      </section>

      <section className="card">

        <h2>State History</h2>

        {stateHistory.length === 0 ? (

          <p>
            No transitions yet.
          </p>

        ) : (

          <table>

            <thead>
              <tr>
                <th>State</th>
                <th>Arduino Time</th>
              </tr>
            </thead>

            <tbody>

              {stateHistory.map(
                (entry, index) => (

                  <tr key={index}>

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

        )}

      </section>

    </div>
  )
}

export default App