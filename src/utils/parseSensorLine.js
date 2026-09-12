export function parseSensorLine(line) {
  const parts = line.trim().split(',')

  // M3/M4 Arduino format:
  // t_ms,ax,ay,az
  if (parts.length !== 4) {
    return null
  }

  const t_ms = Number(parts[0])
  const ax = Number(parts[1])
  const ay = Number(parts[2])
  const az = Number(parts[3])

  if (
    !Number.isFinite(t_ms) ||
    !Number.isFinite(ax) ||
    !Number.isFinite(ay) ||
    !Number.isFinite(az)
  ) {
    return null
  }

  return {
    t_ms,
    ax,
    ay,
    az,
  }
}