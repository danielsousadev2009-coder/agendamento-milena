import { X509Certificate } from 'node:crypto'

export function normalizeDatabaseUrl(value, isProduction) {
  const databaseUrl = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL precisa usar o protocolo PostgreSQL.')
  }
  if (!isProduction) return databaseUrl

  const sslMode = databaseUrl.searchParams.get('sslmode') ?? 'verify-full'
  databaseUrl.searchParams.set('sslmode', sslMode)
  databaseUrl.searchParams.delete('uselibpqcompat')
  if (sslMode !== 'verify-full') {
    throw new Error('DATABASE_URL precisa validar o certificado e o hostname com sslmode=verify-full.')
  }
  return databaseUrl
}

export function getDatabaseSslCa(value) {
  const input = typeof value === 'string' ? value.trim() : ''
  const quote = input[0]
  const unquoted = input.length >= 2
    && (quote === '"' || quote === "'")
    && input.at(-1) === quote
    ? input.slice(1, -1).trim()
    : input
  const encoded = unquoted.replace(/\s+/gu, '')
  const certificate = unquoted.includes('-----BEGIN CERTIFICATE-----')
    ? unquoted
    : /^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
      ? Buffer.from(encoded, 'base64').toString('utf8')
      : ''
  if (!certificate) {
    throw new Error('DATABASE_SSL_CA_BASE64 precisa conter um certificado CA em PEM ou Base64.')
  }
  try {
    if (!new X509Certificate(certificate).ca) {
      throw new Error('O certificado informado não é uma autoridade certificadora.')
    }
  } catch (error) {
    throw new Error('DATABASE_SSL_CA_BASE64 não contém um certificado CA válido.', { cause: error })
  }
  return certificate
}

export function loadConfig(env = process.env) {
  const isProduction = env.NODE_ENV === 'production'
  const allowedOrigins = new Set()
  let frontendOrigin = ''

  if (env.FRONTEND_URL) {
    let frontendUrl
    try {
      frontendUrl = new URL(env.FRONTEND_URL)
    } catch (error) {
      throw new Error('FRONTEND_URL precisa ser uma URL válida.', { cause: error })
    }
    if (frontendUrl.origin !== env.FRONTEND_URL) {
      throw new Error('FRONTEND_URL deve conter somente a origem, sem caminho ou barra final.')
    }
    if (isProduction && frontendUrl.protocol !== 'https:') {
      throw new Error('FRONTEND_URL deve usar HTTPS em produção.')
    }
    frontendOrigin = frontendUrl.origin
    allowedOrigins.add(frontendOrigin)
  }

  if (env.VERCEL_URL) {
    const deploymentUrl = new URL(`https://${env.VERCEL_URL}`)
    if (deploymentUrl.hostname !== env.VERCEL_URL || deploymentUrl.pathname !== '/') {
      throw new Error('VERCEL_URL deve conter somente o hostname atribuído pela Vercel.')
    }
    allowedOrigins.add(deploymentUrl.origin)
  }

  if (!isProduction) {
    allowedOrigins.add('http://localhost:5173')
    allowedOrigins.add('http://127.0.0.1:5173')
  }

  if (isProduction) {
    const required = [
      'DATABASE_URL',
      'DATABASE_SSL_CA_BASE64',
      'JWT_SECRET',
      'PII_ENCRYPTION_KEY',
      'CPF_INDEX_KEY',
      'FRONTEND_URL',
    ]
    const missing = required.filter((name) => !env[name])
    if (missing.length) {
      throw new Error(`Variáveis obrigatórias ausentes: ${missing.join(', ')}.`)
    }
    if (Buffer.byteLength(env.JWT_SECRET, 'utf8') < 32) {
      throw new Error('JWT_SECRET precisa ter pelo menos 32 bytes.')
    }
    normalizeDatabaseUrl(env.DATABASE_URL, true)
    getDatabaseSslCa(env.DATABASE_SSL_CA_BASE64)
  }

  return Object.freeze({
    allowedOrigins,
    frontendOrigin,
    isProduction,
    jwtSecret: env.JWT_SECRET ?? '',
    nodeEnv: env.NODE_ENV ?? 'development',
  })
}
