import { createCsrfToken } from '../middleware/csrf.js'
import {
  createRequest,
  createUrgency,
  findPublicRequest,
  getPublicStatus,
} from '../services/requestService.js'
import {
  validatePublicIdentity,
  validateRequestCreate,
  validateUrgencyCreate,
} from '../validators/api.js'

const COOKIE_AGE_MS = 14 * 24 * 60 * 60 * 1000

function cookieOptions(config) {
  return {
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_AGE_MS,
  }
}

export function publicController(db, config, env) {
  return {
    health(request, response) {
      return response.json({ status: 'ok' })
    },

    csrf(request, response) {
      response.cookie('csrftoken', createCsrfToken(config.jwtSecret), {
        ...cookieOptions(config),
        httpOnly: false,
      })
      return response.json({ detail: 'CSRF cookie set.' })
    },

    async createRequest(request, response) {
      const data = validateRequestCreate(request.body)
      try {
        const result = await createRequest(db, data, env)
        return response.status(201).json({ protocol: result.protocol, status: result.status })
      } catch (error) {
        if (error.code === 'ACTIVE_REQUEST_EXISTS' || (error.code === '23505' && error.constraint?.includes('active_cpf_digest'))) {
          return response.status(409).json({
            detail: 'Você já possui uma solicitação ativa. Use o protocolo recebido para consultar o andamento.',
          })
        }
        throw error
      }
    },

    async lookupRequest(request, response) {
      const data = validatePublicIdentity(request.body)
      const order = await findPublicRequest(db, data, env)
      if (!order) {
        return response.status(404).json({ detail: 'Não encontramos uma solicitação com esses dados.' })
      }
      return response.json(await getPublicStatus(db, order))
    },

    async createUrgency(request, response) {
      const data = validateUrgencyCreate(request.body)
      const order = await findPublicRequest(db, data, env)
      if (!order) {
        return response.status(404).json({
          detail: 'Não foi possível vincular o pedido. Confira o protocolo e o CPF.',
        })
      }
      const urgency = await createUrgency(db, order, data.description, env)
      return response.status(201).json({ received: true, evaluation: urgency.evaluation })
    },
  }
}
