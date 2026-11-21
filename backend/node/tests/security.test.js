import assert from 'node:assert/strict'
import { pbkdf2Sync } from 'node:crypto'
import { rootCertificates } from 'node:tls'
import test from 'node:test'
import { getDatabaseSslCa, loadConfig, normalizeDatabaseUrl } from '../config/env.js'
import { cpfDigest, decryptValue, encryptValue, maskCpf } from '../security/crypto.js'
import { hashDjangoCompatibleBcrypt, verifyDjangoPassword } from '../services/passwordService.js'
import { validateRequestCreate } from '../validators/api.js'

const fernetKey = Buffer.alloc(32, 7).toString('base64')
const env = {
  PII_ENCRYPTION_KEY: fernetKey,
  CPF_INDEX_KEY: 'test-cpf-index-key',
}

test('production config defaults PostgreSQL connections to TLS', () => {
  const rootCertificateBase64 = Buffer.from(rootCertificates[0]).toString('base64')
  const configEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://db.example.test/postgres',
    DATABASE_SSL_CA_BASE64: rootCertificateBase64,
    JWT_SECRET: 'a'.repeat(48),
    PII_ENCRYPTION_KEY: fernetKey,
    CPF_INDEX_KEY: 'test-cpf-index-key',
    FRONTEND_URL: 'https://app.example.test',
  }
  assert.equal(loadConfig(configEnv).isProduction, true)
  const normalizedUrl = normalizeDatabaseUrl(configEnv.DATABASE_URL, true)
  assert.equal(normalizedUrl.searchParams.get('sslmode'), 'verify-full')
  assert.equal(normalizedUrl.searchParams.has('uselibpqcompat'), false)
  assert.equal(getDatabaseSslCa(configEnv.DATABASE_SSL_CA_BASE64), rootCertificates[0])
  assert.equal(getDatabaseSslCa(rootCertificates[0]), rootCertificates[0])
  assert.equal(getDatabaseSslCa(`"${rootCertificateBase64.slice(0, 64)}\n${rootCertificateBase64.slice(64)}"`), rootCertificates[0])

  assert.throws(() => loadConfig({
    ...configEnv,
    DATABASE_SSL_CA_BASE64: Buffer.from('not a certificate').toString('base64'),
  }), /certificado CA válido/u)

  const explicitlyInsecureEnv = {
    ...configEnv,
    DATABASE_URL: 'postgresql://db.example.test/postgres?sslmode=require&uselibpqcompat=true',
  }
  assert.throws(() => loadConfig(explicitlyInsecureEnv), /sslmode=verify-full/u)

  const insecureEnv = {
    ...configEnv,
    DATABASE_URL: 'postgresql://db.example.test/postgres?sslmode=disable',
  }
  assert.throws(() => loadConfig(insecureEnv), /sslmode=verify-full/u)
})

test('Fernet values encrypt and decrypt with the Django-compatible key format', () => {
  const ciphertext = encryptValue('52998224725', env)
  assert.match(ciphertext, /^gAAAA/u)
  assert.equal(decryptValue(ciphertext, env), '52998224725')
  assert.throws(() => decryptValue(`${ciphertext.slice(0, -2)}xx`, env), /could not be decrypted/u)
})

test('CPF digest, masking, and CPF validation preserve expected forms', () => {
  assert.match(cpfDigest('52998224725', env), /^[a-f\d]{64}$/u)
  assert.equal(maskCpf('52998224725'), '***.***.***-25')
  assert.deepEqual(validateRequestCreate({
    full_name: '  Ana   Souza ',
    cpf: '529.982.247-25',
    classroom: '  20 ',
  }), {
    full_name: 'Ana Souza',
    cpf: '52998224725',
    classroom: '20',
  })
  assert.throws(() => validateRequestCreate({
    full_name: 'Ana',
    cpf: '11111111111',
    classroom: '20',
  }), (error) => {
    assert.equal(error.status, 400)
    assert.deepEqual(error.responseBody.full_name, ['Informe seu nome completo.'])
    assert.deepEqual(error.responseBody.cpf, ['Informe um CPF válido.'])
    return true
  })

  assert.throws(() => validateRequestCreate({
    full_name: 'Ana Souza',
    cpf: 'abc52998224725',
    classroom: '20',
  }), (error) => {
    assert.equal(error.status, 400)
    assert.deepEqual(error.responseBody.cpf, ['Informe um CPF válido.'])
    return true
  })

  assert.throws(() => validateRequestCreate({
    full_name: 'Ana Souza',
    cpf: '52998224725',
    classroom: 'sala 20',
  }), (error) => {
    assert.equal(error.status, 400)
    assert.deepEqual(error.responseBody.classroom, ['Informe apenas números para a sala.'])
    return true
  })
})

test('Django PBKDF2 hashes remain verifiable and upgrade to Django-readable bcrypt', async () => {
  const password = 'correct horse battery staple'
  const salt = 'django-salt'
  const digest = pbkdf2Sync(password, salt, 1, 32, 'sha256').toString('base64')
  const pbkdf2Hash = `pbkdf2_sha256$1$${salt}$${digest}`
  assert.equal(await verifyDjangoPassword(password, pbkdf2Hash), true)
  assert.equal(await verifyDjangoPassword('incorrect', pbkdf2Hash), false)

  const bcryptHash = await hashDjangoCompatibleBcrypt(password)
  assert.match(bcryptHash, /^bcrypt_sha256\$\$2b\$/u)
  assert.equal(await verifyDjangoPassword(password, bcryptHash), true)
  assert.equal(await verifyDjangoPassword('incorrect', bcryptHash), false)
})
