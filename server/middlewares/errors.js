import { HttpError } from '../utils/http-error.js'

export function notFound(_request, _response, next) {
  next(new HttpError(404, 'Not found.'))
}

export function errorHandler(error, request, response, _next) {
  if (response.headersSent) return

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : error.type === 'entity.parse.failed'
      ? 400
      : 500
  console.error(JSON.stringify({
    event: 'api_error',
    method: request.method,
    path: request.originalUrl.split('?')[0],
    status,
    code: error.code,
    message: error.message,
  }))

  if (error.fields) {
    response.status(status).json(error.fields)
    return
  }
  if (status === 400 && error.type === 'entity.parse.failed') {
    response.status(400).json({ detail: 'JSON inválido.' })
    return
  }
  response.status(status).json({
    detail: status < 500 ? error.message : 'Ocorreu um erro interno.',
  })
}
