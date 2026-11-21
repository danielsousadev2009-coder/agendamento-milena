import assert from 'node:assert/strict'
import { test } from 'node:test'
import { errorHandler } from '../middleware/errors.js'

test('logs bounded stack frames without exposing the exception message', () => {
  const error = new Error('sensitive backend details')
  error.stack = [
    'Error: sensitive backend details',
    '    at getDashboard (file:///var/task/backend/node/services/requestService.js:66:10)',
    '    at async dashboard (file:///var/task/backend/node/controllers/adminController.js:84:24)',
    '    at async router (file:///var/task/backend/node/routes/api.js:57:10)',
    '    at async createApp (file:///var/task/backend/node/app.js:39:5)',
    '    at async extraFrame (file:///var/task/backend/node/app.js:40:5)',
  ].join('\n')

  const request = {
    requestId: 'test-request-id',
    method: 'GET',
    path: '/api/admin/dashboard/',
  }
  const response = {
    headersSent: false,
    status(statusCode) {
      this.statusCode = statusCode
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
  const originalConsoleError = console.error
  let logArguments
  console.error = (...args) => {
    logArguments = args
  }

  try {
    errorHandler(error, request, response, () => assert.fail('Unexpected next call'))
  } finally {
    console.error = originalConsoleError
  }

  assert.equal(response.statusCode, 500)
  assert.deepEqual(response.body, {
    detail: 'Ocorreu um erro interno. Tente novamente mais tarde.',
  })
  assert.equal(logArguments[1].errorName, 'Error')
  assert.deepEqual(logArguments[1].stack, [
    'at getDashboard (file:///var/task/backend/node/services/requestService.js:66:10)',
    'at async dashboard (file:///var/task/backend/node/controllers/adminController.js:84:24)',
    'at async router (file:///var/task/backend/node/routes/api.js:57:10)',
    'at async createApp (file:///var/task/backend/node/app.js:39:5)',
  ])
  assert.equal(JSON.stringify(logArguments).includes(error.message), false)
})
