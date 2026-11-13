import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function urlSafeBase64(value) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
}

function decodeFernetKey(env) {
  const key = Buffer.from(env.PII_ENCRYPTION_KEY ?? '', 'base64')
  if (key.length !== 32) {
    throw new Error('PII_ENCRYPTION_KEY precisa ser a chave Fernet usada pelo backend Django.')
  }
  return key
}

export function encryptValue(value, env = process.env) {
  const key = decodeFernetKey(env)
  const timestamp = Buffer.alloc(8)
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)))
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-128-cbc', key.subarray(16), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const payload = Buffer.concat([Buffer.from([0x80]), timestamp, iv, ciphertext])
  const signature = createHmac('sha256', key.subarray(0, 16)).update(payload).digest()
  return urlSafeBase64(Buffer.concat([payload, signature]))
}

export function decryptValue(token, env = process.env) {
  const key = decodeFernetKey(env)
  const decoded = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (decoded.length < 73 || decoded[0] !== 0x80 || (decoded.length - 57) % 16 !== 0) {
    throw new Error('Stored personal data could not be decrypted.')
  }

  const payload = decoded.subarray(0, -32)
  const receivedSignature = decoded.subarray(-32)
  const expectedSignature = createHmac('sha256', key.subarray(0, 16)).update(payload).digest()
  if (!timingSafeEqual(receivedSignature, expectedSignature)) {
    throw new Error('Stored personal data could not be decrypted.')
  }

  try {
    const iv = decoded.subarray(9, 25)
    const ciphertext = decoded.subarray(25, -32)
    const decipher = createDecipheriv('aes-128-cbc', key.subarray(16), iv)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch (error) {
    throw new Error('Stored personal data could not be decrypted.', { cause: error })
  }
}

export function cpfDigest(normalizedCpf, env = process.env) {
  if (!env.CPF_INDEX_KEY) {
    throw new Error('CPF_INDEX_KEY não está configurada.')
  }
  return createHmac('sha256', Buffer.from(env.CPF_INDEX_KEY, 'utf8')).update(normalizedCpf, 'utf8').digest('hex')
}

export function maskCpf(normalizedCpf) {
  return `***.***.***-${normalizedCpf.slice(-2)}`
}

export function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function createSessionId() {
  return `s_${randomBytes(24).toString('base64url')}`
}
