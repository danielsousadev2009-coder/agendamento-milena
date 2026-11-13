export async function withTransaction(db, callback) {
  const client = typeof db.connect === 'function' ? await db.connect() : db
  let started = false
  try {
    await client.query('BEGIN')
    started = true
    const result = await callback(client)
    await client.query('COMMIT')
    started = false
    return result
  } catch (error) {
    if (started) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError) {
        console.error('Falha ao reverter transação PostgreSQL:', rollbackError.code ?? 'unknown')
      }
    }
    throw error
  } finally {
    if (client !== db) client.release()
  }
}
