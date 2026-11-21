import jwt from 'jsonwebtoken'
import {
  findPsychologistByIdentifier,
  newSessionId,
  startPsychologistSession,
} from '../models/authRepository.js'
import { hashDjangoCompatibleBcrypt, isDjangoPbkdf2Hash, verifyDjangoPassword } from './passwordService.js'

const JWT_ISSUER = 'agendamento-milena'
const JWT_AUDIENCE = 'psychologist-admin'

function assertJwtSecret(secret) {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET precisa ter pelo menos 32 bytes.')
  }
}

export async function loginPsychologist(db, { username, password }, config) {
  const user = await findPsychologistByIdentifier(db, username)
  if (!user || !user.is_active || !user.psychologist_active) return null
  if (!(await verifyDjangoPassword(password, user.password))) return null

  assertJwtSecret(config.jwtSecret)
  const sessionId = newSessionId()
  const upgradedPasswordHash = isDjangoPbkdf2Hash(user.password)
    ? await hashDjangoCompatibleBcrypt(password)
    : null
  await startPsychologistSession(db, {
    user,
    passwordHash: upgradedPasswordHash,
    sessionId,
  })

  const token = jwt.sign(
    { sid: sessionId },
    config.jwtSecret,
    {
      algorithm: 'HS256',
      audience: JWT_AUDIENCE,
      expiresIn: '14d',
      issuer: JWT_ISSUER,
      subject: String(user.id),
    },
  )
  return { token, sessionId }
}

export function verifyPsychologistToken(token, config) {
  assertJwtSecret(config.jwtSecret)
  const payload = jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
  })
  if (
    typeof payload === 'string'
    || typeof payload.sub !== 'string'
    || typeof payload.sid !== 'string'
  ) {
    throw new Error('Sessão administrativa inválida.')
  }
  return { userId: payload.sub, sessionId: payload.sid }
}
