import { Router } from 'express'
import * as controller from '../controllers/api.js'
import { requirePsychologist } from '../middlewares/auth.js'
import { rateLimit } from '../middlewares/rate-limit.js'
import { requireCsrf } from '../services/auth.js'

const router = Router()

router.get('/health/', controller.healthCheck)
router.get('/csrf/', controller.csrfToken)
router.post('/requests/', rateLimit('request_create'), controller.requestCreate)
router.post('/requests/status/', rateLimit('anonymous'), controller.requestStatus)
router.post('/requests/urgency/', rateLimit('urgency_create'), controller.urgencyCreate)
router.post('/admin/login/', rateLimit('login'), requireCsrf, controller.adminLogin)
router.post('/admin/logout/', requireCsrf, requirePsychologist, rateLimit('user'), controller.adminLogout)
router.get('/admin/dashboard/', requirePsychologist, rateLimit('user'), controller.adminDashboard)
router.route('/admin/requests/:id/')
  .get(requirePsychologist, rateLimit('user'), controller.adminRequestDetails)
  .patch(requireCsrf, requirePsychologist, rateLimit('user'), controller.adminRequestUpdate)
router.get('/admin/urgencies/', requirePsychologist, rateLimit('user'), controller.adminUrgencyList)
router.patch('/admin/urgencies/:id/', requireCsrf, requirePsychologist, rateLimit('user'), controller.adminUrgencyUpdate)
router.get('/admin/urgencies/:id/history/', requirePsychologist, rateLimit('user'), controller.adminUrgencyHistory)

export default router
