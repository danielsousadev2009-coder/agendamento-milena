import 'dotenv/config'
import { emitKeypressEvents } from 'node:readline'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { createPsychologistAccount } from '../models/adminRepository.js'
import { getPool, closePool } from '../config/database.js'
import { hashDjangoCompatibleBcrypt } from '../services/passwordService.js'

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
    throw new Error('A criação da conta exige um terminal interativo para não exibir a senha.')
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
  const prompt = createInterface({ input: stdin, output: stdout })
  const username = (await prompt.question('Usuário ou e-mail: ')).trim()
  prompt.close()
  if (!username) throw new Error('O usuário não pode ficar vazio.')
  if (username.length > 150) throw new Error('O usuário pode ter no máximo 150 caracteres.')

  const password = await readHidden('Senha (não será exibida): ')
  const repeated = await readHidden('Repita a senha: ')
  if (password !== repeated) throw new Error('As senhas não coincidem.')
  const passwordError = validateNewPassword(password, username)
  if (passwordError) throw new Error(passwordError)

  const passwordHash = await hashDjangoCompatibleBcrypt(password)
  const id = await createPsychologistAccount(getPool(), { username, passwordHash })
  console.info(`Conta administrativa criada (id ${id}). Guarde as credenciais em local seguro.`)
}

main()
  .catch((error) => {
    if (error.code === '23505') {
      console.error('O usuário ou o perfil administrativo já existe.')
    } else if (error.code) {
      console.error(`Falha ao criar a conta (código ${error.code}).`)
    } else {
      console.error(error.message)
    }
    process.exitCode = 1
  })
  .finally(closePool)
