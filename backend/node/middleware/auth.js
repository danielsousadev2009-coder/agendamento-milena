import { findActivePsychologistSession } from '../models/authRepository.js'
import { readCookie } from './csrf.js'
import { verifyPsychologistToken } from '../services/authService.js'

export function requirePsychologist(db, config) {
  return async (request, response, next) => {
    const token = readCookie(request, 'admin_session')
    if (!token) {
      return response.status(403).json({ detail: 'Authentication credentials were not provided.' })
    }

    try {
      const { userId, sessionId } = verifyPsychologistToken(token, config)
      const user = await findActivePsychologistSession(db, userId, sessionId)
      if (!user) {
        return response.status(403).json({ detail: 'Acesso restrito à psicóloga autorizada.' })
      }
      request.user = user
      request.authSessionId = sessionId
      return next()
    } catch (error) {
      if (
        error.name === 'JsonWebTokenError'
        || error.name === 'TokenExpiredError'
        || error.name === 'NotBeforeError'
      ) {
        return response.status(403).json({ detail: 'Authentication credentials were not provided.' })
      }
      return next(error)
    }
  }
}
