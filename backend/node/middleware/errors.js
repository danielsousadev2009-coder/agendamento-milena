import { randomUUID } from 'node:crypto'

export function requestContext(request, response, next) {
  request.requestId = randomUUID()
  response.set('X-Request-Id', request.requestId)
  response.set('Cache-Control', 'no-store')
  next()
}

export function methodNotAllowed(methods) {
  return (request, response) => {
    response.set('Allow', `${methods.join(', ')}, OPTIONS`)
    return response.status(405).json({ detail: 'Method not allowed.' })
  }
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error)

  let status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 500
  let body

  if (error.type === 'entity.parse.failed') {
    status = 400
    body = { detail: 'O corpo da solicitação não contém JSON válido.' }
  } else if (error.type === 'entity.too.large') {
    status = 413
    body = { detail: 'O corpo da solicitação excede o limite permitido.' }
  } else if (status >= 500) {
    body = { detail: 'Ocorreu um erro interno. Tente novamente mais tarde.' }
  } else {
    body = error.responseBody ?? { detail: error.message }
  }

  if (status >= 500) {
    const errorName = error && typeof error.name === 'string' ? error.name : typeof error
    const stack = error && typeof error.stack === 'string'
      ? error.stack.split('\n')
        .slice(1)
        .filter((frame) => /^\s*at\s/u.test(frame))
        .slice(0, 4)
        .map((frame) => frame.trim())
      : []
    console.error('Falha na API', {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      code: error.code ?? 'unknown',
      errorName,
      stack,
    })
  }
  return response.status(status).json(body)
}
