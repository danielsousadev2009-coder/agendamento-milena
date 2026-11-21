import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getAllowedOrigins, getJwtSecret, isProduction } from '../config/env.js'
import { pool } from '../config/database.js'
import * as authRepository from '../repositories/auth.js'
import { inTransaction } from '../utils/database.js'
import { signInWithSupabase } from './supabase-auth.js'

const sessionLifetimeSeconds = 8 * 60 * 60
const accessCookie = 'access_token'
const csrfCookie = 'csrftoken'

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function signJwt(userId, sessionKey, now = Math.floor(Date.now() / 1000)) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({
    sub: String(userId),
    sid: sessionKey,
    iat: now,
    exp: now + sessionLifetimeSeconds,
    iss: 'agendamento-milena',
    aud: 'psychologist',
  }))
  const unsigned = `${header}.${payload}`
  const signature = createHmac('sha256', getJwtSecret()).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

function verifyJwt(token, now = Math.floor(Date.now() / 1000)) {
  try {
    const [headerPart, payloadPart, signaturePart, extra] = token.split('.')
    if (!headerPart || !payloadPart || !signaturePart || extra !== undefined) return null
    const unsigned = `${headerPart}.${payloadPart}`
    const expected = createHmac('sha256', getJwtSecret()).update(unsigned).digest()
    const supplied = Buffer.from(signaturePart, 'base64url')
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null

    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'))
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))
    if (header.alg !== 'HS256' || header.typ !== 'JWT'
      || payload.iss !== 'agendamento-milena' || payload.aud !== 'psychologist'
      || typeof payload.sub !== 'string' || typeof payload.sid !== 'string'
      || !Number.isInteger(payload.exp) || payload.exp <= now
      || !Number.isInteger(payload.iat) || payload.iat > now + 60) return null
    return payload
  } catch {
    return null
  }
}

export function readCookie(request, name) {
  const header = request.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

function csrfSignature(value) {
  return createHmac('sha256', getJwtSecret()).update(`csrf:${value}`).digest('base64url')
}

function issueCsrfToken() {
  const value = randomBytes(24).toString('base64url')
  return `${value}.${csrfSignature(value)}`
}

function validCsrfToken(token) {
  if (!token || !token.includes('.')) return false
  const [value, suppliedSignature, extra] = token.split('.')
  if (!value || !suppliedSignature || extra !== undefined) return false
  const expected = Buffer.from(csrfSignature(value))
  const supplied = Buffer.from(suppliedSignature)
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}

export function setCsrfCookie(response) {
  const token = issueCsrfToken()
  response.cookie(csrfCookie, token, {
    httpOnly: false,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: sessionLifetimeSeconds * 1000,
  })
  return token
}

export function requireCsrf(request, response, next) {
  const origin = request.get('origin') ?? request.get('referer')
  if (origin) {
    let originUrl
    try {
      originUrl = new URL(origin)
    } catch {
      response.status(403).json({ detail: 'Origem não autorizada.' })
      return
    }
    if (!getAllowedOrigins().has(originUrl.origin)) {
      response.status(403).json({ detail: 'Origem não autorizada.' })
      return
    }
  }

  const cookieToken = readCookie(request, csrfCookie)
  const headerToken = request.get('x-csrftoken')
  if (!cookieToken || !headerToken || cookieToken !== headerToken || !validCsrfToken(cookieToken)) {
    response.status(403).json({ detail: 'CSRF verification failed.' })
    return
  }
  next()
}

export async function authenticatePsychologist(email, password) {
  const verifiedEmail = await signInWithSupabase(email, password)
  if (!verifiedEmail) return null

  const user = await authRepository.findPsychologistByEmail(pool, verifiedEmail)
  if (!user) return null

  const sessionKey = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000)
  await inTransaction(async (client) => {
    await authRepository.createSession(client, sessionKey, user.id, expiresAt)
    await authRepository.updateLastLogin(client, user.id, user.profile_id)
  })

  return { token: signJwt(user.id, sessionKey), sessionKey }
}

export async function getSessionUser(request) {
  const token = readCookie(request, accessCookie)
  if (!token) return null
  const claims = verifyJwt(token)
  if (!claims) return null
  const session = await authRepository.findActivePsychologistSession(pool, claims.sid)
  if (!session || !session.is_active || !session.profile_active || String(session.id) !== claims.sub) return null
  return { id: Number(session.id), sessionKey: claims.sid }
}

export async function revokeSession(sessionKey) {
  await authRepository.deleteSession(pool, sessionKey)
}

export function setAccessCookie(response, token) {
  response.cookie(accessCookie, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: sessionLifetimeSeconds * 1000,
  })
}

export function clearAccessCookie(response) {
  response.clearCookie(accessCookie, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
  })
}
