import express from 'express'
import { isProduction } from './config/env.js'
import apiRouter from './routes/api.js'
import { corsPolicy } from './middlewares/cors.js'
import { errorHandler, notFound } from './middlewares/errors.js'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', isProduction() ? 1 : false)
app.use((request, response, next) => {
  const startedAt = Date.now()
  response.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  })
  response.on('finish', () => {
    console.info(JSON.stringify({
      event: 'api_request',
      method: request.method,
      path: request.originalUrl.split('?')[0],
      status: response.statusCode,
      duration_ms: Date.now() - startedAt,
    }))
  })
  next()
})
app.use(corsPolicy)
app.use(express.json({ limit: '16kb' }))
app.use('/api', apiRouter)
app.use(notFound)
app.use(errorHandler)

export default app
