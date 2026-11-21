import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { closePool } from '../server/config/database.js'
import { inTransaction } from '../server/utils/database.js'

function readLine(question) {
  const interfaceInstance = createInterface({ input: stdin, output: stdout })
  return new Promise((resolve) => {
    interfaceInstance.question(question, (answer) => {
      interfaceInstance.close()
      resolve(answer)
    })
  })
}

async function main() {
  const email = (await readLine('E-mail da psicóloga: ')).trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Informe um endereço de e-mail válido.')
  }

  await inTransaction(async (client) => {
    const existing = await client.query(
      'SELECT id FROM requests_app_psychologistaccount LIMIT 1',
    )
    if (existing.rows.length) throw new Error('Já existe um perfil de psicóloga cadastrado.')

    const existingUser = await client.query(
      'SELECT id FROM auth_user WHERE LOWER(TRIM(email)) = $1 OR username = $1 LIMIT 1',
      [email],
    )
    if (existingUser.rows.length) throw new Error('Já existe um usuário com esse e-mail.')

    const user = await client.query(
      `INSERT INTO auth_user
        (password, last_login, is_superuser, username, first_name, last_name, email,
         is_staff, is_active, date_joined)
       VALUES ($1, NULL, FALSE, $2, '', '', $3, FALSE, TRUE, NOW())
       RETURNING id`,
      ['!', email, email],
    )
    await client.query(
      `INSERT INTO requests_app_psychologistaccount (active, slot, created_at, last_login_at, user_id)
       VALUES (TRUE, 1, NOW(), NULL, $1)`,
      [user.rows[0].id],
    )
  })
  console.info('Perfil criado. Cadastre ou convide este e-mail no Supabase Auth e confirme a conta.')
}

try {
  await main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await closePool()
}
