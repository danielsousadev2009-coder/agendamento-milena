import 'dotenv/config'
import { closePool, getPool } from '../config/database.js'

const REQUIRED_TABLES = [
  'auth_user',
  'django_session',
  'requests_app_auditevent',
  'requests_app_counselingrequest',
  'requests_app_psychologistaccount',
  'requests_app_queuecounter',
  'requests_app_urgencyrequest',
]

async function main() {
  const pool = getPool()
  await pool.query('SELECT 1')
  const result = await pool.query(
    `SELECT table_name
     FROM unnest($1::text[]) AS required(table_name)
     WHERE to_regclass(format('public.%I', table_name)) IS NULL`,
    [REQUIRED_TABLES],
  )
  if (result.rows.length) {
    throw new Error(`Tabelas legadas ausentes: ${result.rows.map((row) => row.table_name).join(', ')}.`)
  }
  console.info('Conexão PostgreSQL válida; tabelas legadas esperadas encontradas.')
}

main()
  .catch((error) => {
    console.error('Falha ao validar PostgreSQL:', error.message)
    process.exitCode = 1
  })
  .finally(closePool)
