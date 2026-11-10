import { pool } from '../config/database.js'

export async function inTransaction(operation) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error(JSON.stringify({ event: 'database_rollback_error', message: rollbackError.message }))
    }
    throw error
  } finally {
    client.release()
  }
}
