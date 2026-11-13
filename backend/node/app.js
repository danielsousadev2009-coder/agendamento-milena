import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { loadConfig } from './config/env.js'
import { getPool } from './config/database.js'
import { errorHandler, requestContext } from './middleware/errors.js'
import { createApiRouter } from './routes/api.js'

export function createApp({ db: suppliedDatabase, env = process.env } = {}) {
  const config = loadConfig(env)
  const db = suppliedDatabase ?? {
    query: (...args) => getPool(env).query(...args),
    connect: (...args) => getPool(env).connect(...args),
  }
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', config.isProduction ? 1 : 'loopback')
  app.use(requestContext)
  app.use(helmet({
    strictTransportSecurity: config.isProduction ? undefined : false,
  }))
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.has(origin)) return callback(null, true)
      const error = new Error('Origem não autorizada.')
      error.status = 403
      error.responseBody = { detail: 'Origem não autorizada.' }
      return callback(error)
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRFToken'],
    maxAge: 600,
  }))
  app.use(express.json({ limit: '16kb', strict: true }))
  app.use('/api', createApiRouter(db, config, env))
  app.use((request, response) => response.status(404).json({ detail: 'Endpoint não encontrado.' }))
  app.use(errorHandler)
  return app
}

const app = createApp()
export default app
