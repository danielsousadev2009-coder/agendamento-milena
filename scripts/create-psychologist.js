import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { StringDecoder } from 'node:string_decoder'
import { closePool } from '../server/config/database.js'
import { hashPassword } from '../server/utils/crypto.js'
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

function readSecret(question) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('A terminal is required to enter the password securely.')
  }
  return new Promise((resolve, reject) => {
    const characters = []
    const decoder = new StringDecoder('utf8')
    stdout.write(question)
    stdin.setRawMode(true)
    stdin.resume()

    function finish(error) {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
      if (error) reject(error)
      else resolve(characters.join(''))
    }

    function onData(buffer) {
      for (const character of decoder.write(buffer)) {
        if (character === '\u0003') {
          finish(new Error('Password entry cancelled.'))
          return
        }
        if (character === '\r' || character === '\n') {
          finish()
          return
        }
        if (character === '\u007f' || character === '\b') {
          characters.pop()
          continue
        }
        if (character >= ' ') {
          characters.push(character)
          stdout.write('*')
        }
      }
    }

    stdin.on('data', onData)
  })
}

async function main() {
  const username = (await readLine('Usuário ou e-mail: ')).trim()
  if (!username || username.length > 150) throw new Error('O usuário deve conter entre 1 e 150 caracteres.')
  const password = await readSecret('Senha (mínimo de 8 caracteres): ')
  const repeated = await readSecret('Repita a senha: ')
  if (password !== repeated) throw new Error('As senhas não coincidem.')
  if (password.length < 8 || /^\d+$/.test(password) || password.toLowerCase().includes(username.toLowerCase())) {
    throw new Error('A senha deve ter ao menos 8 caracteres, não ser apenas numérica e não conter o usuário.')
  }

  await inTransaction(async (client) => {
    const existing = await client.query(
      'SELECT id FROM requests_app_psychologistaccount LIMIT 1',
    )
    if (existing.rows.length) throw new Error('Já existe um perfil de psicóloga cadastrado.')

    const user = await client.query(
      `INSERT INTO auth_user
        (password, last_login, is_superuser, username, first_name, last_name, email,
         is_staff, is_active, date_joined)
       VALUES ($1, NULL, FALSE, $2, '', '', $3, FALSE, TRUE, NOW())
       RETURNING id`,
      [hashPassword(password), username, username.includes('@') ? username : ''],
    )
    await client.query(
      `INSERT INTO requests_app_psychologistaccount (active, slot, created_at, last_login_at, user_id)
       VALUES (TRUE, 1, NOW(), NULL, $1)`,
      [user.rows[0].id],
    )
  })
  console.info('Conta administrativa criada. Guarde as credenciais em local seguro.')
}

try {
  await main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await closePool()
}
