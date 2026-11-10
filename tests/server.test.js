import assert from 'node:assert/strict'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
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

const { validateCpf, cpfDigest, decryptValue, encryptValue, hashPassword, verifyPassword } = await import('../server/utils/crypto.js')
const { validatePrivateIdentity, validateRequestCreate, validateRequestUpdate, validateUrgencyCreate } = await import('../server/validators/api.js')
const { getDatabaseConfig } = await import('../server/config/env.js')
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

test('legacy Django PBKDF2 hashes and new bcrypt-sha256 hashes authenticate', () => {
  const password = 'Example-password-2026'
  const salt = 'legacy-test-salt'
  const digest = pbkdf2Sync(password, salt, 1_000, 32, 'sha256').toString('base64')
  assert.equal(verifyPassword(password, `pbkdf2_sha256$1000$${salt}$${digest}`), true)
  assert.equal(verifyPassword('wrong-password', `pbkdf2_sha256$1000$${salt}$${digest}`), false)
  const newHash = hashPassword(password)
  assert.match(newHash, /^bcrypt_sha256\$\$2[aby]\$/)
  assert.equal(verifyPassword(password, newHash), true)
  assert.equal(verifyPassword('wrong-password', newHash), false)
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
