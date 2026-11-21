import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import { after, before, test } from 'node:test'
import { createApp } from '../app.js'

const CPF = '52998224725'
const ENV = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-jwt-secret-that-is-long-enough-for-hmac',
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  CPF_INDEX_KEY: 'test-cpf-index-key',
  FRONTEND_URL: 'http://localhost:5173',
}

class MemoryDatabase {
  constructor() {
    this.requests = []
    this.urgencies = []
    this.audits = []
    this.sessions = new Map()
    this.rateCounts = new Map()
    this.additionalUsers = []
    this.queueOrder = 0
    this.nextRequestId = 1
    this.nextUrgencyId = 1
    const salt = 'test-salt'
    const hash = pbkdf2Sync('test-password-123', salt, 1, 32, 'sha256').toString('base64')
    this.user = {
      id: 1,
      username: 'psychologist',
      email: 'psychologist@example.test',
      password: `pbkdf2_sha256$1$${salt}$${hash}`,
      is_active: true,
      psychologist_active: true,
    }
  }

  connect() {
    return { query: this.query.bind(this), release() {} }
  }

  async query(sql, values = []) {
    const query = sql.replace(/\s+/gu, ' ').trim()
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(query)) return { rows: [], rowCount: 0 }

    if (query.startsWith('WITH expired_rate_limits AS')) {
      const count = (this.rateCounts.get(values[0]) ?? 0) + 1
      this.rateCounts.set(values[0], count)
      return { rows: [{ count, expire_date: values[1] }], rowCount: 1 }
    }
    if (query.includes('FROM auth_user u') && query.includes('psychologistaccount p')) {
      const identifier = String(values[0])
      const matches = [this.user, ...this.additionalUsers]
        .filter((user) => user.username === identifier
          || user.email?.toLowerCase() === identifier.toLowerCase())
        .sort((left, right) => Number(left.username !== identifier) - Number(right.username !== identifier))
        .slice(0, 2)
      return {
        rows: matches.map((user) => ({ ...user })),
        rowCount: matches.length,
      }
    }
    if (query.includes('FROM django_session s')) {
      const session = this.sessions.get(values[1])
      return {
        rows: session && String(this.user.id) === String(values[0]) && this.user.is_active && this.user.psychologist_active
          ? [{ id: this.user.id, username: this.user.username }]
          : [],
        rowCount: session ? 1 : 0,
      }
    }
    if (query.startsWith('UPDATE auth_user SET password =')) {
      this.user.password = values[0]
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('UPDATE auth_user SET last_login =')) {
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('UPDATE requests_app_psychologistaccount')) {
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('INSERT INTO django_session')) {
      this.sessions.set(values[0], { session_data: values[1] ?? '{}', expire_date: values[2] })
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('DELETE FROM django_session')) {
      this.sessions.delete(values[0])
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('SELECT last_order FROM requests_app_queuecounter')) {
      return { rows: [{ last_order: this.queueOrder }], rowCount: 1 }
    }
    if (query.startsWith('SELECT id FROM requests_app_queuecounter')) {
      return { rows: [{ id: 1 }], rowCount: 1 }
    }
    if (query.startsWith('SELECT id FROM requests_app_counselingrequest WHERE active_cpf_digest')) {
      const request = this.requests.find((item) => item.active_cpf_digest === values[0])
      return { rows: request ? [{ id: request.id }] : [], rowCount: request ? 1 : 0 }
    }
    if (query.startsWith('UPDATE requests_app_queuecounter')) {
      this.queueOrder = values[0]
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('INSERT INTO requests_app_counselingrequest')) {
      const request = {
        id: this.nextRequestId++,
        full_name: values[0],
        cpf_ciphertext: values[1],
        cpf_digest: values[2],
        active_cpf_digest: values[2],
        classroom: values[3],
        protocol: values[4],
        received_at: new Date(),
        updated_at: new Date(),
        status: 'waiting',
        completed_at: null,
        queue_order: values[5],
        contact_status: 'not_started',
        contacted_at: null,
        contact_note: '',
      }
      this.requests.push(request)
      return { rows: [{ id: request.id, protocol: request.protocol, status: request.status }], rowCount: 1 }
    }
    if (query.includes("'request_created'")) {
      this.audits.push({
        request_id: values[0],
        urgency_id: null,
        action: 'request_created',
        previous_state: {},
        new_state: JSON.parse(values[1]),
        reason: '',
        created_at: new Date(),
      })
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('SELECT id, full_name, cpf_ciphertext, cpf_digest')) {
      const request = this.requests.find((item) => item.protocol === values[0])
      return { rows: request ? [{ ...request }] : [], rowCount: request ? 1 : 0 }
    }
    if (query.startsWith('SELECT COUNT(*)::integer AS position')) {
      const position = this.requests.filter((item) => ['waiting', 'review', 'in_progress'].includes(item.status)
        && item.queue_order <= values[1]).length
      return { rows: [{ position }], rowCount: 1 }
    }
    if (query.startsWith('INSERT INTO requests_app_urgencyrequest')) {
      const urgency = {
        id: this.nextUrgencyId++,
        request_id: values[0],
        description_ciphertext: values[1],
        submitted_at: new Date(),
        evaluation: 'pending',
        evaluated_at: null,
        reason: '',
      }
      this.urgencies.push(urgency)
      return { rows: [{ id: urgency.id, evaluation: urgency.evaluation }], rowCount: 1 }
    }
    if (query.includes("'urgency_submitted'")) {
      this.audits.push({
        request_id: values[0],
        urgency_id: values[1],
        action: 'urgency_submitted',
        previous_state: {},
        new_state: JSON.parse(values[2]),
        reason: '',
        created_at: new Date(),
      })
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('SELECT id, full_name, classroom, protocol, received_at')) {
      return {
        rows: [...this.requests].sort((a, b) => a.queue_order - b.queue_order).map((item) => ({ ...item })),
        rowCount: this.requests.length,
      }
    }
    if (query.startsWith('SELECT status, COUNT(*)::integer AS total')) {
      const totals = new Map()
      for (const request of this.requests) totals.set(request.status, (totals.get(request.status) ?? 0) + 1)
      return { rows: [...totals].map(([status, total]) => ({ status, total })), rowCount: totals.size }
    }
    if (query.startsWith('SELECT COUNT(*)::integer AS total FROM requests_app_urgencyrequest')) {
      return {
        rows: [{ total: this.urgencies.filter((urgency) => urgency.evaluation === 'pending').length }],
        rowCount: 1,
      }
    }
    if (query.startsWith('SELECT id, full_name, cpf_ciphertext, classroom, protocol, status, contact_status')) {
      const request = this.requests.find((item) => String(item.id) === String(values[0]))
      return { rows: request ? [{ ...request }] : [], rowCount: request ? 1 : 0 }
    }
    if (query.startsWith('SELECT action, previous_state, new_state, reason, created_at FROM requests_app_auditevent')) {
      const history = this.audits.filter((audit) => String(audit.request_id) === String(values[0]))
        .sort((a, b) => b.created_at - a.created_at)
      return { rows: history, rowCount: history.length }
    }
    if (query.startsWith('SELECT id, status, contact_status, contact_note, cpf_digest, queue_order')) {
      const request = this.requests.find((item) => String(item.id) === String(values[0]))
      return { rows: request ? [{ ...request }] : [], rowCount: request ? 1 : 0 }
    }
    if (query.startsWith('UPDATE requests_app_counselingrequest SET status =')) {
      const request = this.requests.find((item) => String(item.id) === String(values[9]))
      if (request) {
        request.status = values[0]
        request.contact_status = values[1]
        request.contact_note = values[2]
        if (values[3]) request.active_cpf_digest = values[4]
        if (values[5]) request.completed_at = values[6]
        if (values[7]) request.contacted_at = values[8]
      }
      return { rows: [], rowCount: request ? 1 : 0 }
    }
    if (query.includes("'request_updated'")) {
      this.audits.push({
        request_id: values[0],
        urgency_id: null,
        action: 'request_updated',
        previous_state: JSON.parse(values[1]),
        new_state: JSON.parse(values[2]),
        reason: values[3],
        created_at: new Date(),
      })
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('SELECT id FROM requests_app_counselingrequest WHERE status = ANY')) {
      const rows = this.requests.filter((item) => ['waiting', 'review', 'in_progress'].includes(item.status))
        .sort((a, b) => a.queue_order - b.queue_order)
        .map((item) => ({ id: item.id }))
      return { rows, rowCount: rows.length }
    }
    if (query.startsWith('UPDATE requests_app_counselingrequest SET queue_order =')) {
      const request = this.requests.find((item) => item.id === values[1])
      if (request) request.queue_order = values[0]
      return { rows: [], rowCount: request ? 1 : 0 }
    }
    if (query.includes("'queue_reordered'")) {
      this.audits.push({
        request_id: values[0],
        urgency_id: null,
        action: 'queue_reordered',
        previous_state: JSON.parse(values[1]),
        new_state: JSON.parse(values[2]),
        reason: values[3],
        created_at: new Date(),
      })
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('SELECT u.id, u.request_id, r.full_name AS student_name')) {
      const urgencies = this.urgencies
        .filter((urgency) => !values[0] || urgency.evaluation === values[0])
        .map((urgency) => {
          const request = this.requests.find((item) => item.id === urgency.request_id)
          return {
            ...urgency,
            student_name: request.full_name,
            classroom: request.classroom,
            protocol: request.protocol,
          }
        })
        .sort((a, b) => Number(a.evaluation !== 'pending') - Number(b.evaluation !== 'pending')
          || a.submitted_at - b.submitted_at)
      return { rows: urgencies, rowCount: urgencies.length }
    }
    if (query.startsWith('SELECT id, request_id, evaluation FROM requests_app_urgencyrequest')) {
      const urgency = this.urgencies.find((item) => String(item.id) === String(values[0]))
      return { rows: urgency ? [{ ...urgency }] : [], rowCount: urgency ? 1 : 0 }
    }
    if (query.startsWith('UPDATE requests_app_urgencyrequest SET evaluation =')) {
      const urgency = this.urgencies.find((item) => String(item.id) === String(values[3]))
      if (urgency) {
        urgency.evaluation = values[0]
        urgency.reason = values[1]
        urgency.evaluated_at = new Date()
      }
      return { rows: [], rowCount: urgency ? 1 : 0 }
    }
    if (query.includes("'urgency_evaluated'")) {
      this.audits.push({
        request_id: values[0],
        urgency_id: values[1],
        action: 'urgency_evaluated',
        previous_state: JSON.parse(values[2]),
        new_state: JSON.parse(values[3]),
        reason: values[4],
        created_at: new Date(),
      })
      return { rows: [], rowCount: 1 }
    }
    if (query.startsWith('SELECT action, previous_state, new_state, reason, created_at FROM requests_app_auditevent')) {
      const history = this.audits.filter((audit) => String(audit.urgency_id) === String(values[0]))
        .sort((a, b) => b.created_at - a.created_at)
      return { rows: history, rowCount: history.length }
    }
    throw new Error(`Consulta de teste não prevista: ${query}`)
  }
}

let server
let baseUrl
let database

before(async () => {
  database = new MemoryDatabase()
  server = createApp({ db: database, env: ENV }).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

async function call(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options)
  const body = response.status === 204 ? null : await response.json()
  return { response, body, cookies: response.headers.getSetCookie() }
}

function csrfCookie(cookies) {
  const cookie = cookies.find((value) => value.startsWith('csrftoken='))
  assert.ok(cookie, 'CSRF cookie should be set')
  return cookie.split(';', 1)[0]
}

test('public endpoints preserve health, CSRF, validation, creation, status, and urgency flows', async () => {
  const health = await call('/api/health/')
  assert.equal(health.response.status, 200)
  assert.deepEqual(health.body, { status: 'ok' })

  const csrf = await call('/api/csrf/')
  assert.equal(csrf.response.status, 200)
  assert.equal(csrf.body.detail, 'CSRF cookie set.')
  assert.match(csrf.cookies.join(';'), /SameSite=Lax/u)

  const invalid = await call('/api/requests/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Ana', cpf: '11111111111', classroom: '2' }),
  })
  assert.equal(invalid.response.status, 400)
  assert.deepEqual(invalid.body.full_name, ['Informe seu nome completo.'])
  assert.deepEqual(invalid.body.cpf, ['Informe um CPF válido.'])

  const nonNumeric = await call('/api/requests/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Ana Souza', cpf: `abc${CPF}`, classroom: 'sala 2' }),
  })
  assert.equal(nonNumeric.response.status, 400)
  assert.deepEqual(nonNumeric.body.cpf, ['Informe um CPF válido.'])
  assert.deepEqual(nonNumeric.body.classroom, ['Informe apenas números para a sala.'])
  assert.equal(database.requests.length, 0)

  const created = await call('/api/requests/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Ana Souza', cpf: CPF, classroom: '20' }),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.status, 'waiting')
  assert.match(created.body.protocol, /^AC-/u)

  const duplicate = await call('/api/requests/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Ana Souza', cpf: CPF, classroom: '20' }),
  })
  assert.equal(duplicate.response.status, 409)

  const lookup = await call('/api/requests/status/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocol: created.body.protocol, cpf: CPF }),
  })
  assert.equal(lookup.response.status, 200)
  assert.deepEqual(lookup.body, { status: 'waiting', queue_position: 1 })

  const wrongIdentity = await call('/api/requests/status/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocol: created.body.protocol, cpf: '11144477735' }),
  })
  assert.equal(wrongIdentity.response.status, 404)

  const urgency = await call('/api/requests/urgency/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocol: created.body.protocol, cpf: CPF, description: 'Preciso conversar hoje.' }),
  })
  assert.equal(urgency.response.status, 201)
  assert.deepEqual(urgency.body, { received: true, evaluation: 'pending' })
})

test('admin endpoints require CSRF and a psychologist session, then support dashboard CRUD and logout', async () => {
  const noCsrf = await call('/api/admin/login/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ENV.FRONTEND_URL },
    body: JSON.stringify({ username: 'psychologist', password: 'test-password-123' }),
  })
  assert.equal(noCsrf.response.status, 403)

  const noSession = await call('/api/admin/dashboard/')
  assert.equal(noSession.response.status, 403)
  const noSessionStatus = await call('/api/admin/session/')
  assert.equal(noSessionStatus.response.status, 403)

  const csrf = await call('/api/csrf/')
  const csrfCookieHeader = csrfCookie(csrf.cookies)
  const csrfToken = csrfCookieHeader.slice('csrftoken='.length)
  const invalidLogin = await call('/api/admin/login/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ENV.FRONTEND_URL,
      Cookie: csrfCookieHeader,
      'X-CSRFToken': csrfToken,
    },
    body: JSON.stringify({ username: 'psychologist', password: 'wrong-password' }),
  })
  assert.equal(invalidLogin.response.status, 400)
  assert.equal(database.sessions.size, 0)

  database.additionalUsers.push({
    ...database.user,
    id: 2,
    username: 'another-psychologist',
  })
  let ambiguousLogin
  try {
    ambiguousLogin = await call('/api/admin/login/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ENV.FRONTEND_URL,
        Cookie: csrfCookieHeader,
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify({ username: 'PSYCHOLOGIST@EXAMPLE.TEST', password: 'test-password-123' }),
    })
  } finally {
    database.additionalUsers.pop()
  }
  assert.equal(ambiguousLogin.response.status, 400)
  assert.equal(database.sessions.size, 0)

  const login = await call('/api/admin/login/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ENV.FRONTEND_URL,
      Cookie: csrfCookieHeader,
      'X-CSRFToken': csrfToken,
    },
    body: JSON.stringify({ username: 'PSYCHOLOGIST@EXAMPLE.TEST', password: 'test-password-123' }),
  })
  assert.equal(login.response.status, 200)
  assert.deepEqual(login.body, { authenticated: true })
  assert.match(database.user.password, /^bcrypt_sha256\$\$/u)

  const cookies = login.cookies
  const sessionCookie = cookies.find((value) => value.startsWith('admin_session='))
  const sessionHeader = sessionCookie.split(';', 1)[0]
  const updatedCsrfCookie = csrfCookie(cookies)
  const updatedCsrfToken = updatedCsrfCookie.slice('csrftoken='.length)
  const cookieHeader = `${sessionHeader}; ${updatedCsrfCookie}`

  const encryptionKey = ENV.PII_ENCRYPTION_KEY
  ENV.PII_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64')
  let dashboard
  try {
    dashboard = await call('/api/admin/dashboard/', { headers: { Cookie: cookieHeader } })
  } finally {
    ENV.PII_ENCRYPTION_KEY = encryptionKey
  }
  assert.equal(dashboard.response.status, 200)
  assert.equal(dashboard.body.requests.length, 1)
  assert.equal(Object.hasOwn(dashboard.body.requests[0], 'cpf_masked'), false)
  assert.equal(dashboard.body.pending_urgencies, 1)

  const activeSession = await call('/api/admin/session/', { headers: { Cookie: cookieHeader } })
  assert.equal(activeSession.response.status, 200)
  assert.deepEqual(activeSession.body, { authenticated: true })

  const detail = await call('/api/admin/requests/1/', { headers: { Cookie: cookieHeader } })
  assert.equal(detail.response.status, 200)
  assert.equal(detail.body.full_name, 'Ana Souza')
  assert.equal(detail.body.completed_at, null)

  const update = await call('/api/admin/requests/1/', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: ENV.FRONTEND_URL,
      Cookie: cookieHeader,
      'X-CSRFToken': updatedCsrfToken,
    },
    body: JSON.stringify({ status: 'review', contact_status: 'contacted' }),
  })
  assert.equal(update.response.status, 200)
  assert.deepEqual(update.body, { updated: true })

  const reorder = await call('/api/admin/requests/1/', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: ENV.FRONTEND_URL,
      Cookie: cookieHeader,
      'X-CSRFToken': updatedCsrfToken,
    },
    body: JSON.stringify({ queue_position: 1, reason: 'Prioridade de atendimento.' }),
  })
  assert.equal(reorder.response.status, 200)
  assert.ok(database.audits.some((audit) => audit.action === 'queue_reordered'))

  const completed = await call('/api/admin/requests/1/', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: ENV.FRONTEND_URL,
      Cookie: cookieHeader,
      'X-CSRFToken': updatedCsrfToken,
    },
    body: JSON.stringify({ status: 'completed' }),
  })
  assert.equal(completed.response.status, 200)
  assert.ok(database.requests[0].completed_at instanceof Date)
  assert.ok(database.audits.some((audit) => audit.action === 'request_updated' && audit.new_state.status === 'completed'))

  const completedDetail = await call('/api/admin/requests/1/', { headers: { Cookie: cookieHeader } })
  assert.equal(completedDetail.response.status, 200)
  assert.equal(completedDetail.body.completed_at, database.requests[0].completed_at.toISOString())

  const completedStatus = await call('/api/requests/status/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocol: database.requests[0].protocol, cpf: CPF }),
  })
  assert.equal(completedStatus.response.status, 200)
  assert.deepEqual(completedStatus.body, {
    status: 'completed',
    queue_position: null,
    completed_at: database.requests[0].completed_at.toISOString(),
  })

  const urgencyList = await call('/api/admin/urgencies/', { headers: { Cookie: cookieHeader } })
  assert.equal(urgencyList.response.status, 200)
  assert.equal(urgencyList.body.urgencies.length, 1)
  assert.equal(urgencyList.body.urgencies[0].description, 'Preciso conversar hoje.')

  const evaluation = await call('/api/admin/urgencies/1/', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Origin: ENV.FRONTEND_URL,
      Cookie: cookieHeader,
      'X-CSRFToken': updatedCsrfToken,
    },
    body: JSON.stringify({ evaluation: 'confirmed', reason: 'Prioridade de atendimento.' }),
  })
  assert.equal(evaluation.response.status, 200)
  assert.deepEqual(evaluation.body, { updated: true })

  const history = await call('/api/admin/urgencies/1/history/', { headers: { Cookie: cookieHeader } })
  assert.equal(history.response.status, 200)
  assert.equal(history.body.history[0].action, 'urgency_evaluated')

  const logout = await call('/api/admin/logout/', {
    method: 'POST',
    headers: {
      Origin: ENV.FRONTEND_URL,
      Cookie: cookieHeader,
      'X-CSRFToken': updatedCsrfToken,
    },
  })
  assert.equal(logout.response.status, 204)
  assert.equal(database.sessions.size, 0)
  const endedSession = await call('/api/admin/session/', { headers: { Cookie: cookieHeader } })
  assert.equal(endedSession.response.status, 403)

  const wrongMethod = await call('/api/requests/')
  assert.equal(wrongMethod.response.status, 405)
})

test('public status throttling rejects the request after the configured hourly limit', async () => {
  let lastResult
  for (let count = 0; count < 60; count += 1) {
    lastResult = await call('/api/requests/status/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protocol: 'not-found', cpf: CPF }),
    })
  }
  assert.equal(lastResult.response.status, 429)
  assert.ok(Number(lastResult.response.headers.get('retry-after')) > 0)
})
