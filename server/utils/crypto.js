import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

function getKey(name, expectedBytes) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required.`)
  const key = Buffer.from(value, 'base64')
  if (key.length !== expectedBytes) throw new Error(`${name} must be a base64-encoded ${expectedBytes}-byte key.`)
  return key
}

export function normalizeCpf(value) {
  return value.replace(/\D/g, '')
}

export function validateCpf(value) {
  const digits = normalizeCpf(value)
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return null

  const checkDigit = (length) => {
    const sum = Array.from(digits.slice(0, length), (digit, index) => Number(digit) * (length + 1 - index))
      .reduce((total, value) => total + value, 0)
    const remainder = (sum * 10) % 11
    return remainder === 10 ? 0 : remainder
  }

  return Number(digits[9]) === checkDigit(9) && Number(digits[10]) === checkDigit(10)
    ? digits
    : null
}

export function cpfDigest(cpf) {
  const key = process.env.CPF_INDEX_KEY
  if (!key || Buffer.byteLength(key) < 32) throw new Error('CPF_INDEX_KEY must be at least 32 bytes.')
  return createHmac('sha256', key).update(cpf).digest('hex')
}

export function encryptValue(value) {
  const key = getKey('PII_ENCRYPTION_KEY', 32)
  const signingKey = key.subarray(0, 16)
  const encryptionKey = key.subarray(16)
  const header = Buffer.alloc(9)
  header[0] = 0x80
  header.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)), 1)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-128-cbc', encryptionKey, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const signedContent = Buffer.concat([header, iv, ciphertext])
  const signature = createHmac('sha256', signingKey).update(signedContent).digest()
  return Buffer.concat([signedContent, signature]).toString('base64url')
}

export function decryptValue(token) {
  const encoded = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (encoded.length < 73 || encoded[0] !== 0x80 || (encoded.length - 57) % 16 !== 0) {
    throw new Error('Stored personal data could not be decrypted.')
  }

  const key = getKey('PII_ENCRYPTION_KEY', 32)
  const signingKey = key.subarray(0, 16)
  const encryptionKey = key.subarray(16)
  const signedContent = encoded.subarray(0, -32)
  const suppliedSignature = encoded.subarray(-32)
  const expectedSignature = createHmac('sha256', signingKey).update(signedContent).digest()

  if (!timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw new Error('Stored personal data could not be decrypted.')
  }

  try {
    const iv = encoded.subarray(9, 25)
    const decipher = createDecipheriv('aes-128-cbc', encryptionKey, iv)
    return Buffer.concat([decipher.update(encoded.subarray(25, -32)), decipher.final()]).toString('utf8')
  } catch (error) {
    throw new Error('Stored personal data could not be decrypted.', { cause: error })
  }
}

export function maskCpf(cpf) {
  return `***.***.***-${cpf.slice(-2)}`
}
