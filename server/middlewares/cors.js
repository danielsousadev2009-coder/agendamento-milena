import { getAllowedOrigins } from '../config/env.js'

export function corsPolicy(request, response, next) {
  const origin = request.get('origin')
  if (!origin) {
    if (request.method === 'OPTIONS') {
      response.status(204).end()
      return
    }
    next()
    return
  }

  if (!getAllowedOrigins().has(origin)) {
    if (request.method === 'OPTIONS') {
      response.status(403).json({ detail: 'Origem não autorizada.' })
      return
    }
    next()
    return
  }

  response.set('Access-Control-Allow-Origin', origin)
  response.set('Access-Control-Allow-Credentials', 'true')
  response.set('Vary', 'Origin')
  if (request.method === 'OPTIONS') {
    response.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
    response.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRFToken')
    response.status(204).end()
    return
  }
  next()
}
