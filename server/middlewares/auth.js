import { getSessionUser } from '../services/auth.js'

export async function requirePsychologist(request, response, next) {
  const user = await getSessionUser(request)
  if (!user) {
    response.status(403).json({ detail: 'Authentication credentials were not provided.' })
    return
  }
  request.user = user
  next()
}
