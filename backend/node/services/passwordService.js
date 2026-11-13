import { createHash, pbkdf2 as pbkdf2Callback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import bcrypt from 'bcryptjs'

const pbkdf2 = promisify(pbkdf2Callback)

export async function verifyDjangoPassword(password, encoded) {
  const parts = encoded.split('$')
  if (parts[0] === 'pbkdf2_sha256' && parts.length === 4) {
    const iterations = Number(parts[1])
    const expected = Buffer.from(parts[3], 'base64')
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000 || expected.length !== 32) {
      return false
    }
    const actual = await pbkdf2(password, parts[2], iterations, 32, 'sha256')
    return timingSafeEqual(actual, expected)
  }

  if (parts[0] === 'bcrypt_sha256' && parts.length === 5 && parts[1] === '') {
    const digest = createHash('sha256').update(password, 'utf8').digest('hex')
    return bcrypt.compare(digest, encoded.slice('bcrypt_sha256$'.length))
  }

  return false
}

export async function hashDjangoCompatibleBcrypt(password) {
  const digest = createHash('sha256').update(password, 'utf8').digest('hex')
  const hash = await bcrypt.hash(digest, 12)
  return `bcrypt_sha256$${hash}`
}

export function isDjangoPbkdf2Hash(encoded) {
  return encoded.startsWith('pbkdf2_sha256$')
}
