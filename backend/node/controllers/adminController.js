import { endPsychologistSession } from '../models/authRepository.js'
import { createCsrfToken } from '../middleware/csrf.js'
import { loginPsychologist } from '../services/authService.js'
import {
  getDashboard,
  getRequestDetail,
  getUrgencies,
  getUrgencyAuditHistory,
  reviewUrgency,
  updateRequest,
} from '../services/requestService.js'
import {
  validateAdminCredentials,
  validateRequestStatus,
  validateUrgencyEvaluation,
} from '../validators/api.js'

const COOKIE_AGE_MS = 14 * 24 * 60 * 60 * 1000

function sessionCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_AGE_MS,
  }
}

function csrfCookieOptions(config) {
  return {
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_AGE_MS,
    httpOnly: false,
  }
}

function validId(value) {
  return /^\d+$/u.test(value)
}

function queryValue(query, name) {
  const value = query[name]
  if (Array.isArray(value)) return String(value.at(-1) ?? '')
  return typeof value === 'string' ? value : ''
}

function invalidQueuePosition(error) {
  if (error.code !== 'INVALID_QUEUE_POSITION') throw error
  error.status = 400
  error.responseBody = { detail: error.message }
  throw error
}

export function adminController(db, config, env) {
  return {
    session(request, response) {
      return response.json({ authenticated: true })
    },

    async login(request, response) {
      const credentials = validateAdminCredentials(request.body)
      const session = await loginPsychologist(db, credentials, config)
      if (!session) {
        return response.status(400).json({
          detail: 'Não foi possível entrar. Confira os dados ou tente mais tarde.',
        })
      }
      response.cookie('admin_session', session.token, sessionCookieOptions(config))
      response.cookie('csrftoken', createCsrfToken(config.jwtSecret), csrfCookieOptions(config))
      return response.json({ authenticated: true })
    },

    async logout(request, response) {
      await endPsychologistSession(db, request.authSessionId)
      response.clearCookie('admin_session', sessionCookieOptions(config))
      response.clearCookie('csrftoken', csrfCookieOptions(config))
      return response.status(204).end()
    },

    async dashboard(request, response) {
      return response.json(await getDashboard(db, request.query))
    },

    async requestDetails(request, response) {
      if (!validId(request.params.id)) {
        return response.status(404).json({ detail: 'Solicitação não encontrada.' })
      }
      const result = await getRequestDetail(db, request.params.id, env)
      if (!result) return response.status(404).json({ detail: 'Solicitação não encontrada.' })
      return response.json(result)
    },

    async updateRequest(request, response) {
      if (!validId(request.params.id)) {
        return response.status(404).json({ detail: 'Solicitação não encontrada.' })
      }
      const data = validateRequestStatus(request.body)
      try {
        const updated = await updateRequest(db, request.params.id, data, request.user.id)
        if (!updated) return response.status(404).json({ detail: 'Solicitação não encontrada.' })
        return response.json({ updated: true })
      } catch (error) {
        invalidQueuePosition(error)
      }
    },

    async urgencies(request, response) {
      const evaluation = queryValue(request.query, 'evaluation')
      return response.json({ urgencies: await getUrgencies(db, evaluation, env) })
    },

    async evaluateUrgency(request, response) {
      if (!validId(request.params.id)) {
        return response.status(404).json({ detail: 'Solicitação de urgência não encontrada.' })
      }
      const data = validateUrgencyEvaluation(request.body)
      const updated = await reviewUrgency(db, request.params.id, data, request.user.id)
      if (!updated) {
        return response.status(404).json({ detail: 'Solicitação de urgência não encontrada.' })
      }
      return response.json({ updated: true })
    },

    async urgencyHistory(request, response) {
      if (!validId(request.params.id)) {
        return response.status(404).json({ detail: 'Histórico não encontrado.' })
      }
      const history = await getUrgencyAuditHistory(db, request.params.id)
      if (!history.length) return response.status(404).json({ detail: 'Histórico não encontrado.' })
      return response.json({ history })
    },
  }
}
