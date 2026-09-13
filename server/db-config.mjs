// Explicit local-demo opt-in. Production always requires certificate verification.
export function databaseConfig(env = process.env) {
  const insecure = env.ACUPILL_DEV_INSECURE_TLS === 'true'
  if (insecure && env.NODE_ENV === 'production') {
    throw new Error('Development TLS bypass is forbidden in production')
  }
  const url = new URL(env.DATABASE_URL)
  // URL SSL options override pg's explicit ssl object, so remove them.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) {
    url.searchParams.delete(key)
  }
  if (insecure) console.warn('DEVELOPMENT ONLY: TLS encryption on; server certificate verification OFF. Use synthetic demo data only.')
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: !insecure },
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  }
}
