import 'dotenv/config'
import { emitKeypressEvents } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { getPool, closePool } from '../config/database.js'
import { hashDjangoCompatibleBcrypt } from '../services/passwordService.js'
import { withTransaction } from '../models/transaction.js'

function validateNewPassword(password, username) {
  if (password.length < 14) return 'A senha precisa ter pelo menos 14 caracteres.'
  if (/^\d+$/u.test(password)) return 'A senha não pode conter apenas números.'
  if (username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
    return 'A senha não pode conter o nome de usuário.'
  }
  const normalized = password.toLowerCase()
  if (['password', 'senha', 'qwerty', 'welcome', 'admin', 'letmein', '123456', '000000']
    .some((value) => normalized.includes(value))) {
    return 'Escolha uma senha menos comum.'
  }
  const characterGroups = [
    /[a-z]/u.test(password),
    /[A-Z]/u.test(password),
    /\d/u.test(password),
    /[^a-z\d]/iu.test(password),
  ].filter(Boolean).length
  if (characterGroups < 3) return 'Use pelo menos três tipos de caracteres na senha.'
}

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('A redefinição exige um terminal interativo para não exibir a senha.')
  }
  emitKeypressEvents(stdin)
  stdin.setRawMode(true)
  stdin.resume()
  stdout.write(prompt)

  return new Promise((resolve, reject) => {
    let value = ''
    function finish(error) {
      stdin.removeListener('keypress', onKeypress)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    function onKeypress(character, key = {}) {
      if (key.ctrl && key.name === 'c') {
        finish(new Error('Operação cancelada.'))
      } else if (key.name === 'return' || key.name === 'enter') {
        finish()
      } else if (key.name === 'backspace') {
        value = value.slice(0, -1)
      } else if (!key.ctrl && !key.meta && character) {
        value += character
      }
    }
    stdin.on('keypress', onKeypress)
  })
}

async function main() {
  const db = getPool()
  const activeAccounts = await db.query(
    `SELECT u.id, u.username
     FROM auth_user u
     JOIN requests_app_psychologistaccount p ON p.user_id = u.id
     WHERE u.is_active = TRUE AND p.active = TRUE
     ORDER BY p.id
     LIMIT 2`,
  )
  if (activeAccounts.rowCount !== 1) {
    throw new Error(
      activeAccounts.rowCount
        ? 'Há mais de uma conta ativa de psicóloga; nenhuma senha foi alterada.'
        : 'Nenhuma conta ativa de psicóloga foi encontrada; nenhuma senha foi alterada.',
    )
  }

  const account = activeAccounts.rows[0]
  console.info(`Conta ativa localizada: ${account.username}.`)
  const password = await readHidden('Nova senha (não será exibida): ')
  const repeated = await readHidden('Repita a nova senha: ')
  if (password !== repeated) throw new Error('As senhas não coincidem.')
  const passwordError = validateNewPassword(password, account.username)
  if (passwordError) throw new Error(passwordError)
  const passwordHash = await hashDjangoCompatibleBcrypt(password)
  const revokedSessions = await withTransaction(db, async (client) => {
    const lockedAccount = await client.query(
      `SELECT u.id
       FROM auth_user u
       JOIN requests_app_psychologistaccount p ON p.user_id = u.id
       WHERE u.id = $1 AND u.is_active = TRUE AND p.active = TRUE
       FOR UPDATE OF u, p`,
      [activeAccounts.rows[0].id],
    )
    if (lockedAccount.rowCount !== 1) {
      throw new Error('O estado da conta mudou durante a redefinição; nenhuma senha foi alterada.')
    }

    await client.query(
      'UPDATE auth_user SET password = $1 WHERE id = $2',
      [passwordHash, lockedAccount.rows[0].id],
    )
    const revoked = await client.query(
      "DELETE FROM django_session WHERE left(session_key, 2) = 's_'",
    )
    return revoked.rowCount
  })

  console.info(`Senha redefinida para ${activeAccounts.rows[0].username}; ${revokedSessions} sessão(ões) do painel encerrada(s).`)
}

main()
  .catch((error) => {
    if (error.code) {
      console.error(`Falha ao redefinir a senha (código ${error.code}).`)
    } else {
      console.error(error.message)
    }
    process.exitCode = 1
  })
  .finally(closePool)
