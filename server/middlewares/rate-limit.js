import { createHmac } from 'node:crypto'
import { getJwtSecret } from '../config/env.js'
import { consumeRateLimit } from '../repositories/auth.js'
import { inTransaction } from '../utils/database.js'

const limits = {
  anonymous: { requests: 60, windowMs: 60 * 60 * 1000 },
  login: { requests: 5, windowMs: 60 * 1000 },
  request_create: { requests: 5, windowMs: 60 * 60 * 1000 },
  urgency_create: { requests: 3, windowMs: 60 * 60 * 1000 },
  user: { requests: 300, windowMs: 60 * 60 * 1000 },
}

export function rateLimit(scope) {
  const limit = limits[scope]
  if (!limit) throw new Error(`Unknown rate-limit scope: ${scope}`)

  return async (request, response, next) => {
    const identity = scope === 'user' ? `user:${request.user.id}` : request.ip
    const digest = createHmac('sha256', getJwtSecret())
      .update(`${scope}\0${identity}`)
      .digest('hex')
      .slice(0, 32)
    const sessionKey = `rl_${digest}`
    const result = await inTransaction((client) => (
      consumeRateLimit(client, sessionKey, limit.requests, limit.windowMs)
    ))
    if (!result.allowed) {
      const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000))
      response.set('Retry-After', String(seconds))
      response.status(429).json({ detail: `Request was throttled. Expected available in ${seconds} seconds.` })
      return
    }
    next()
  }
}
