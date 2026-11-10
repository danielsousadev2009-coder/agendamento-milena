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
          finish(new Error('Password reset cancelled.'))
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
  const username = (await readLine('Usuário ou e-mail da conta: ')).trim()
  if (!username || username.length > 150) throw new Error('O usuário deve conter entre 1 e 150 caracteres.')
  const password = await readSecret('Nova senha (mínimo de 8 caracteres): ')
  const repeated = await readSecret('Repita a nova senha: ')
  if (password !== repeated) throw new Error('As senhas não coincidem.')
  if (password.length < 8 || /^\d+$/.test(password) || password.toLowerCase().includes(username.toLowerCase())) {
    throw new Error('A senha deve ter ao menos 8 caracteres, não ser apenas numérica e não conter o usuário.')
  }

  await inTransaction(async (client) => {
    const result = await client.query(
      `SELECT u.id
       FROM auth_user AS u
       JOIN requests_app_psychologistaccount AS p ON p.user_id = u.id
       WHERE u.username = $1 AND u.is_active = TRUE AND p.active = TRUE
       LIMIT 1`,
      [username],
    )
    const user = result.rows[0]
    if (!user) throw new Error('Não foi encontrada uma conta administrativa ativa com esse usuário.')

    await client.query('UPDATE auth_user SET password = $1 WHERE id = $2', [
      hashPassword(password),
      user.id,
    ])
    await client.query(
      'DELETE FROM django_session WHERE session_data = $1',
      [JSON.stringify({ node_session: true, user_id: String(user.id) })],
    )
  })
  console.info('Senha redefinida. As sessões anteriores da conta foram encerradas.')
}

try {
  await main()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await closePool()
}
