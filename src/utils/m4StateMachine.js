export function createM4Machine() {
  return {
    state: 'IDLE',

    stateStartedAt: 0,

    handlingCount: 0,
    tiltCount: 0,
    returnCount: 0,
    idleCount: 0,

    previousData: null,

    history: [],

    debug: {
      motionAmount: 0,
      isIdle: false,
      isHandling: false,
      isTilted: false,
      isReturned: false,
      isMoving: false,
    },
  }
}

function transition(machine, newState, time) {
  return {
    ...machine,

    state: newState,
    stateStartedAt: time,

    handlingCount: 0,
    tiltCount: 0,
    returnCount: 0,
    idleCount: 0,

    history: [
      {
        state: newState,
        time,
      },
      ...machine.history,
    ].slice(0, 10),
  }
}

export function updateM4Machine(machine, data) {
  const { t_ms, ax, ay, az } = data

  let motionAmount = 0

  if (machine.previousData) {
    motionAmount =
      Math.abs(ax - machine.previousData.ax) +
      Math.abs(ay - machine.previousData.ay) +
      Math.abs(az - machine.previousData.az)
  }

  // -----------------------------
  // CALIBRATED M4 CONDITIONS
  // -----------------------------

  const isIdle =
    ay > 0.88 &&
    Math.abs(az) < 0.10 &&
    ax > -0.10

  const calibratedHandling =
    ax < -0.12 &&
    ay > 0.80 &&
    Math.abs(az) < 0.20

  const isTilted =
    az < -0.55

  const isReturned =
    ay > 0.80 &&
    Math.abs(az) < 0.20

  // Helps detect pickup even if the exact
  // calibrated handling orientation is missed.
  const isMoving =
    motionAmount > 0.10

  let next = {
    ...machine,

    previousData: data,

    debug: {
      motionAmount,
      isIdle,
      isHandling: calibratedHandling,
      isTilted,
      isReturned,
      isMoving,
    },
  }

  const timeInState =
    t_ms - machine.stateStartedAt

  // =====================================
  // IDLE → HANDLING
  // =====================================

  if (machine.state === 'IDLE') {
    /*
      We allow several signs of handling:

      1. The calibrated handling position
      2. Significant movement
      3. Leaving the normal resting orientation
      4. A strong tilt beginning quickly

      Even if someone tilts quickly, we still
      enter HANDLING first.
    */

    const handlingTrigger =
      calibratedHandling ||
      isMoving ||
      !isIdle ||
      isTilted

    next.handlingCount = handlingTrigger
      ? machine.handlingCount + 1
      : 0

    if (next.handlingCount >= 2) {
      return transition(
        next,
        'HANDLING',
        t_ms
      )
    }

    return next
  }

  // =====================================
  // HANDLING → TILTED
  // =====================================

  if (machine.state === 'HANDLING') {
    next.tiltCount = isTilted
      ? machine.tiltCount + 1
      : 0

    /*
      At ~250 ms/sample:
      two samples ≈ 500 ms.
    */

    if (
      timeInState >= 250 &&
      next.tiltCount >= 2
    ) {
      return transition(
        next,
        'TILTED',
        t_ms
      )
    }

    /*
      Recovery from accidental bump.

      If we enter HANDLING but immediately
      return to rest without tilting, go
      back to IDLE.
    */

    next.idleCount = isIdle
      ? machine.idleCount + 1
      : 0

    if (next.idleCount >= 4) {
      return transition(
        next,
        'IDLE',
        t_ms
      )
    }

    return next
  }

  // =====================================
  // TILTED → RETURNED
  // =====================================

  if (machine.state === 'TILTED') {
    const uprightAfterTilt =
      isReturned && !isTilted

    next.returnCount = uprightAfterTilt
      ? machine.returnCount + 1
      : 0

    if (next.returnCount >= 3) {
      return transition(
        next,
        'RETURNED',
        t_ms
      )
    }

    return next
  }

  // =====================================
  // RETURNED → IDLE
  // =====================================

  if (machine.state === 'RETURNED') {
    next.idleCount = isIdle
      ? machine.idleCount + 1
      : 0

    /*
      Keep RETURNED visible before going
      back to IDLE.
    */

    if (
      timeInState >= 750 &&
      next.idleCount >= 3
    ) {
      return transition(
        next,
        'IDLE',
        t_ms
      )
    }

    return next
  }

  return next
}