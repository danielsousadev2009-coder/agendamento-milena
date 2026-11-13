import { Router } from 'express'
import { adminController } from '../controllers/adminController.js'
import { publicController } from '../controllers/publicController.js'
import { requirePsychologist } from '../middleware/auth.js'
import { requireCsrf } from '../middleware/csrf.js'
import { methodNotAllowed } from '../middleware/errors.js'
import { persistentRateLimit } from '../middleware/rateLimit.js'

export function createApiRouter(db, config, env) {
  const router = Router()
  const publicApi = publicController(db, config, env)
  const adminApi = adminController(db, config, env)
  const requireAdmin = requirePsychologist(db, config)
  const csrf = requireCsrf(config)
  const publicStatusLimit = persistentRateLimit(db, config, {
    scope: 'public-status',
    limit: 60,
    windowMs: 60 * 60 * 1000,
  })
  const requestCreateLimit = persistentRateLimit(db, config, {
    scope: 'request-create',
    limit: 5,
    windowMs: 60 * 60 * 1000,
  })
  const urgencyCreateLimit = persistentRateLimit(db, config, {
    scope: 'urgency-create',
    limit: 3,
    windowMs: 60 * 60 * 1000,
  })
  const loginLimit = persistentRateLimit(db, config, {
    scope: 'admin-login',
    limit: 5,
    windowMs: 60 * 1000,
  })
  const adminLimit = persistentRateLimit(db, config, {
    scope: 'admin-user',
    limit: 300,
    windowMs: 60 * 60 * 1000,
    keyForRequest: (request) => String(request.user.id),
  })

  router.route('/health/')
    .get(publicApi.health)
    .all(methodNotAllowed(['GET', 'HEAD']))
  router.route('/csrf/')
    .get(publicApi.csrf)
    .all(methodNotAllowed(['GET', 'HEAD']))
  router.route('/requests/')
    .post(requestCreateLimit, publicApi.createRequest)
    .all(methodNotAllowed(['POST']))
  router.route('/requests/status/')
    .post(publicStatusLimit, publicApi.lookupRequest)
    .all(methodNotAllowed(['POST']))
  router.route('/requests/urgency/')
    .post(urgencyCreateLimit, publicApi.createUrgency)
    .all(methodNotAllowed(['POST']))
  router.route('/admin/login/')
    .post(csrf, loginLimit, adminApi.login)
    .all(methodNotAllowed(['POST']))
  router.route('/admin/logout/')
    .post(requireAdmin, csrf, adminLimit, adminApi.logout)
    .all(methodNotAllowed(['POST']))
  router.route('/admin/session/')
    .get(requireAdmin, adminLimit, adminApi.session)
    .all(methodNotAllowed(['GET', 'HEAD']))
  router.route('/admin/dashboard/')
    .get(requireAdmin, adminLimit, adminApi.dashboard)
    .all(methodNotAllowed(['GET', 'HEAD']))
  router.route('/admin/requests/:id/')
    .get(requireAdmin, adminLimit, adminApi.requestDetails)
    .patch(requireAdmin, csrf, adminLimit, adminApi.updateRequest)
    .all(methodNotAllowed(['GET', 'HEAD', 'PATCH']))
  router.route('/admin/urgencies/')
    .get(requireAdmin, adminLimit, adminApi.urgencies)
    .all(methodNotAllowed(['GET', 'HEAD']))
  router.route('/admin/urgencies/:id/')
    .patch(requireAdmin, csrf, adminLimit, adminApi.evaluateUrgency)
    .all(methodNotAllowed(['PATCH']))
  router.route('/admin/urgencies/:id/history/')
    .get(requireAdmin, adminLimit, adminApi.urgencyHistory)
    .all(methodNotAllowed(['GET', 'HEAD']))
  router.use((request, response) => response.status(404).json({ detail: 'Endpoint não encontrado.' }))

  return router
}
