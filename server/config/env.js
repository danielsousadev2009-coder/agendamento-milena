import 'dotenv/config'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} must be configured.`)
  return value
}

export function getDatabaseConfig() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (connectionString) {
    let url
    try {
      url = new URL(connectionString)
    } catch (error) {
      throw new Error('DATABASE_URL must be a valid PostgreSQL URL.', { cause: error })
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      throw new Error('DATABASE_URL must use the PostgreSQL protocol.')
    }
    const sslMode = process.env.DB_SSLMODE?.toLowerCase() ?? url.searchParams.get('sslmode')?.toLowerCase() ?? 'require'
    url.searchParams.delete('sslmode')
    url.searchParams.delete('sslrootcert')
    return {
      connectionString: url.toString(),
      ssl: getSslConfig(sslMode),
    }
  }

  const sslMode = process.env.DB_SSLMODE?.toLowerCase() ?? 'require'
  const host = required('DB_HOST')
  const database = required('DB_NAME')
  const user = required('DB_USER')
  const password = required('DB_PASSWORD')
  const port = Number(process.env.DB_PORT ?? 5432)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.')
  }

  return {
    host,
    database,
    user,
    password,
    port,
    ssl: getSslConfig(sslMode),
  }
}

function getSslConfig(mode) {
  if (mode === 'disable') return false
  if (mode === 'require') return { rejectUnauthorized: false }
  if (mode === 'verify-full') {
    const ca = process.env.DB_SSL_CA
    return {
      rejectUnauthorized: true,
      ...(ca ? { ca: Buffer.from(ca, 'base64').toString('utf8') } : {}),
    }
  }
  throw new Error('DB_SSLMODE must be "require", "verify-full", or "disable".')
}

export function getJwtSecret() {
  const secret = required('JWT_SECRET')
  if (Buffer.byteLength(secret) < 32) throw new Error('JWT_SECRET must be at least 32 bytes.')
  return secret
}

export function getFrontendOrigin() {
  const value = process.env.FRONTEND_URL?.trim()
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error('FRONTEND_URL must be configured in production.')
  }
  if (!value) return null

  let url
  try {
    url = new URL(value)
  } catch (error) {
    throw new Error('FRONTEND_URL must be a valid URL.', { cause: error })
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value.replace(/\/$/, '')) {
    throw new Error('FRONTEND_URL must contain only an origin.')
  }
  if (isProduction() && url.protocol !== 'https:') {
    throw new Error('FRONTEND_URL must use HTTPS in production.')
  }
  return url.origin
}

export function getAllowedOrigins() {
  const origins = new Set([getFrontendOrigin()])
  if (!isProduction()) {
    origins.add('http://localhost:5173')
    origins.add('http://127.0.0.1:5173')
  }

  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
    if (!host) continue
    try {
      const url = new URL(`https://${host}`)
      if (url.hostname.endsWith('.vercel.app') && url.pathname === '/') origins.add(url.origin)
    } catch {
      continue
    }
  }
  return origins
}

export function isProduction() {
  return process.env.NODE_ENV === 'production'
}
