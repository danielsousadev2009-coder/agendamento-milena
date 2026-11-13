import pg from 'pg'
import { getDatabaseSslCa, normalizeDatabaseUrl } from './env.js'

const { Pool } = pg
let pool

export function getPool(env = process.env) {
  if (pool) return pool
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL não está configurada.')
  }

  const isProduction = env.NODE_ENV === 'production'
  const connectionUrl = normalizeDatabaseUrl(env.DATABASE_URL, isProduction)
  let ssl
  if (isProduction) {
    ssl = {
      ca: getDatabaseSslCa(env.DATABASE_SSL_CA_BASE64),
      rejectUnauthorized: true,
    }
    for (const parameter of [
      'sslmode',
      'ssl',
      'sslrootcert',
      'sslcert',
      'sslkey',
      'sslpassword',
      'sslnegotiation',
      'uselibpqcompat',
    ]) {
      connectionUrl.searchParams.delete(parameter)
    }
  }

  pool = new Pool({
    connectionString: connectionUrl.toString(),
    ...(ssl ? { ssl } : {}),
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  })
  pool.on('error', (error) => {
    console.error('Erro inesperado no pool PostgreSQL:', error.code ?? 'unknown')
  })
  return pool
}

export async function closePool() {
  if (!pool) return
  const currentPool = pool
  pool = undefined
  await currentPool.end()
}
