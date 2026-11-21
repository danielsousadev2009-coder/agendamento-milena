import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= randomBytes(48).toString('base64url')
process.env.PII_ENCRYPTION_KEY ??= Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
process.env.CPF_INDEX_KEY ??= 'test-cpf-index-key-not-for-production-0001'
process.env.DB_HOST ??= '127.0.0.1'
process.env.DB_NAME ??= 'test'
process.env.DB_USER ??= 'test'
process.env.DB_PASSWORD ??= 'test'
process.env.DB_SSLMODE = 'disable'
process.env.SUPABASE_URL ??= 'https://project.supabase.co'
process.env.SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test_key'

const { validateCpf, cpfDigest, decryptValue, encryptValue } = await import('../server/utils/crypto.js')
const { validatePrivateIdentity, validateRequestCreate, validateRequestUpdate, validateUrgencyCreate } = await import('../server/validators/api.js')
const { getDatabaseConfig, getSupabaseAuthConfig } = await import('../server/config/env.js')
const { signInWithSupabase } = await import('../server/services/supabase-auth.js')
const { default: app } = await import('../server/app.js')
const { default: vercelFunction } = await import('../api/[...path].js')
const { default: vercelAdminFunction } = await import('../api/admin/[...path].js')

let server
let baseUrl

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('CPF validation accepts standard formatting and rejects invalid identities', () => {
  assert.equal(validateCpf('529.982.247-25'), '52998224725')
  assert.equal(validateCpf('111.111.111-11'), null)
  assert.equal(validateCpf('123'), null)
  assert.equal(cpfDigest('52998224725').length, 64)
})

test('Fernet encryption is interoperable with existing Python ciphertexts', () => {
  const key = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
  process.env.PII_ENCRYPTION_KEY = key
  const fixture = 'gAAAAABq60BVxD8h9Okqb9ibd5_kjCrBaUcUnZr2GdlvgQJQn61J89KwRMREgnrJ07SWICZGm-E7kJyJW3TMUPLzfCRpch0kHw=='
  assert.equal(decryptValue(fixture), '52998224725')
  const encrypted = encryptValue('mensagem de teste')
  assert.equal(decryptValue(encrypted), 'mensagem de teste')
  assert.throws(() => decryptValue(`${encrypted.slice(0, -2)}aa`), /could not be decrypted/)
})

test('Supabase connection URLs retain transaction-pooler settings and encrypted TLS', () => {
  const previousUrl = process.env.DATABASE_URL
  const previousSslMode = process.env.DB_SSLMODE
  process.env.DATABASE_URL = 'postgresql://test:placeholder@pooler.example:6543/postgres?sslmode=require'
  process.env.DB_SSLMODE = 'require'
  try {
    const config = getDatabaseConfig()
    const url = new URL(config.connectionString)
    assert.equal(url.hostname, 'pooler.example')
    assert.equal(url.port, '6543')
    assert.equal(url.searchParams.has('sslmode'), false)
    assert.equal(config.ssl.rejectUnauthorized, false)
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousUrl
    if (previousSslMode === undefined) delete process.env.DB_SSLMODE
    else process.env.DB_SSLMODE = previousSslMode
  }
})

test('Supabase Auth config requires only the project URL and publishable key', () => {
  const config = getSupabaseAuthConfig()
  assert.equal(config.url, 'https://project.supabase.co')
  assert.equal(config.publishableKey, 'sb_publishable_test_key')
})

test('health route remains available when downstream service configuration is invalid', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousSupabaseUrl = process.env.SUPABASE_URL
  const previousPublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
  process.env.DATABASE_URL = 'invalid-database-url'
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_PUBLISHABLE_KEY

  try {
    const response = await fetch(`${baseUrl}/api/health/`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = previousSupabaseUrl
    if (previousPublishableKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY
    else process.env.SUPABASE_PUBLISHABLE_KEY = previousPublishableKey
  }
})

test('Supabase Auth accepts only confirmed email sign-ins', async (context) => {
  let request
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) }
    return new Response(JSON.stringify({
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'refresh-token',
      user: {
        id: 'auth-user-id',
        email: 'admin@example.com',
        email_confirmed_at: '2026-01-01T00:00:00Z',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        aud: 'authenticated',
        created_at: '2026-01-01T00:00:00Z',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })

  assert.equal(await signInWithSupabase('admin@example.com', 'correct-password'), 'admin@example.com')
  assert.match(request.url, /\/auth\/v1\/token\?grant_type=password$/)
  assert.deepEqual(request.body, {
    email: 'admin@example.com',
    password: 'correct-password',
    gotrue_meta_security: {},
  })
})

test('Supabase Auth rejects invalid credentials and unconfirmed email', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => (
    new Response(JSON.stringify({ code: 'invalid_credentials', message: 'Invalid login credentials' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  ))
  assert.equal(await signInWithSupabase('admin@example.com', 'wrong-password'), null)

  context.mock.restoreAll()
  context.mock.method(globalThis, 'fetch', async () => (
    new Response(JSON.stringify({
      access_token: 'access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'refresh-token',
      user: { id: 'auth-user-id', email: 'admin@example.com' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  ))
  assert.equal(await signInWithSupabase('admin@example.com', 'correct-password'), null)
})

test('request validators retain required limits and normalized payload values', () => {
  assert.deepEqual(validateRequestCreate({
    full_name: '  Ana   Souza ',
    cpf: '529.982.247-25',
    classroom: '  8º   ano ',
  }).values, {
    full_name: 'Ana Souza',
    cpf: '52998224725',
    classroom: '8º ano',
  })
  assert.deepEqual(validatePrivateIdentity({ protocol: ' AC-123 ', cpf: '52998224725' }).values, {
    protocol: 'AC-123',
    cpf: '52998224725',
  })
  assert.ok(validateRequestCreate({ full_name: 'Ana', cpf: '11111111111', classroom: '' }).errors)
  assert.ok(validateRequestCreate({ full_name: 'Ana Souza', cpf: 'abc52998224725', classroom: '8º ano' }).errors.cpf)
  assert.ok(validateRequestCreate({ full_name: 'Ana Souza', cpf: '529.982.247/25', classroom: '8º ano' }).errors.cpf)
  assert.ok(validatePrivateIdentity({ protocol: 'AC-123', cpf: '52998224725xyz' }).errors.cpf)
  assert.ok(validateUrgencyCreate({
    protocol: 'AC-123',
    cpf: '52998224725',
    description: 'curta',
  }).errors.description)
  assert.equal(validateRequestUpdate({ queue_position: 2, reason: 'Justificativa' }).values.queue_position, 2)
  assert.equal(validateRequestUpdate({ queue_position: '2', reason: 'Justificativa' }).values.queue_position, 2)
})

test('Express API health and CSRF responses use same-origin secure defaults', async () => {
  assert.equal(vercelFunction, app)
  assert.equal(vercelAdminFunction, app)
  const health = await fetch(`${baseUrl}/api/health/`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })
  assert.equal(health.headers.get('cache-control'), 'no-store')
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff')

  const csrf = await fetch(`${baseUrl}/api/csrf/`)
  assert.equal(csrf.status, 200)
  assert.deepEqual(await csrf.json(), { detail: 'CSRF cookie set.' })
  assert.match(csrf.headers.get('set-cookie'), /^csrftoken=/)
  assert.doesNotMatch(csrf.headers.get('set-cookie'), /HttpOnly/i)
})

test('admin endpoints remain protected and CORS rejects unlisted origins', async () => {
  const protectedResponse = await fetch(`${baseUrl}/api/admin/dashboard/`)
  assert.equal(protectedResponse.status, 403)
  assert.equal((await protectedResponse.json()).detail, 'Authentication credentials were not provided.')

  const corsResponse = await fetch(`${baseUrl}/api/health/`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://untrusted.example' },
  })
  assert.equal(corsResponse.status, 403)

  const allowedCorsResponse = await fetch(`${baseUrl}/api/health/`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173' },
  })
  assert.equal(allowedCorsResponse.status, 204)
  assert.equal(allowedCorsResponse.headers.get('access-control-allow-origin'), 'http://localhost:5173')
})
