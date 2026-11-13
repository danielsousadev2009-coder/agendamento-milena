import { createHmac, randomBytes } from 'node:crypto'
import { safeCompare } from '../security/crypto.js'

const TOKEN_AGE_SECONDS = 14 * 24 * 60 * 60

function csrfSignature(value, secret) {
  return createHmac('sha256', secret).update(`csrf:${value}`).digest('base64url')
}

export function createCsrfToken(secret) {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET precisa ter pelo menos 32 bytes para assinar tokens CSRF.')
  }
  const value = `${Math.floor(Date.now() / 1000)}.${randomBytes(32).toString('base64url')}`
  return `${value}.${csrfSignature(value, secret)}`
}

export function readCookie(request, name) {
  const cookieHeader = request.headers.cookie
  if (!cookieHeader) return ''
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    return part.slice(separator + 1).trim()
  }
  return ''
}

function hasAllowedOrigin(request, config) {
  const origin = request.get('origin')
  if (!origin) return true
  return config.allowedOrigins.has(origin)
}

function isValidCsrfToken(token, secret) {
  const pieces = token.split('.')
  if (pieces.length !== 3 || !/^\d+$/u.test(pieces[0])) return false
  const issuedAt = Number(pieces[0])
  const now = Math.floor(Date.now() / 1000)
  if (issuedAt > now + 60 || now - issuedAt > TOKEN_AGE_SECONDS) return false
  return safeCompare(pieces[2], csrfSignature(`${pieces[0]}.${pieces[1]}`, secret))
}

export function requireCsrf(config) {
  return (request, response, next) => {
    const cookieToken = readCookie(request, 'csrftoken')
    const headerToken = request.get('x-csrftoken') ?? ''
    if (
      !hasAllowedOrigin(request, config)
      || !cookieToken
      || !safeCompare(cookieToken, headerToken)
      || !isValidCsrfToken(cookieToken, config.jwtSecret)
    ) {
      return response.status(403).json({ detail: 'A validação CSRF falhou. Atualize a página e tente novamente.' })
    }
    return next()
  }
}
