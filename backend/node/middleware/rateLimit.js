import { createHmac, randomInt } from 'node:crypto'

export function persistentRateLimit(db, config, { scope, limit, windowMs, keyForRequest }) {
  return async (request, response, next) => {
    const ip = keyForRequest ? keyForRequest(request) : request.ip
    const bucket = Math.floor(Date.now() / windowMs)
    const windowEnd = new Date((bucket + 1) * windowMs)
    const digest = createHmac('sha256', config.jwtSecret)
      .update(`${scope}:${ip}:${bucket}`)
      .digest('base64url')
      .slice(0, 37)
    const sessionKey = `rl_${digest}`

    try {
      const result = await db.query(
        `WITH expired_rate_limits AS (
           DELETE FROM django_session
           WHERE left(session_key, 3) = 'rl_'
             AND expire_date <= NOW()
             AND $3::boolean
           RETURNING session_key
         )
         INSERT INTO django_session (session_key, session_data, expire_date)
         VALUES ($1, '1', $2)
         ON CONFLICT (session_key) DO UPDATE
           SET session_data = (django_session.session_data::integer + 1)::text
         RETURNING session_data::integer AS count, expire_date`,
        [sessionKey, windowEnd, randomInt(100) === 0],
      )
      const { count, expire_date: expiresAt } = result.rows[0]
      if (count > limit) {
        const retryAfter = Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000))
        response.set('Retry-After', String(retryAfter))
        return response.status(429).json({
          detail: `Request was throttled. Expected available in ${retryAfter} seconds.`,
        })
      }
      return next()
    } catch (error) {
      return next(error)
    }
  }
}
