import pg from 'pg'
import { getDatabaseConfig } from './env.js'

const { Pool } = pg
let instance

function getPool() {
  if (!instance) {
    const max = Number(process.env.PG_POOL_MAX ?? 1)
    if (!Number.isInteger(max) || max < 1 || max > 20) {
      throw new Error('PG_POOL_MAX must be an integer between 1 and 20.')
    }
    instance = new Pool({
      ...getDatabaseConfig(),
      max,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    })
    instance.on('error', (error) => {
      console.error(JSON.stringify({ event: 'database_pool_error', message: error.message }))
    })
  }
  return instance
}

export const pool = new Proxy({}, {
  get(_target, property) {
    const activePool = getPool()
    const value = activePool[property]
    return typeof value === 'function' ? value.bind(activePool) : value
  },
})

export async function closePool() {
  if (instance) await instance.end()
}
