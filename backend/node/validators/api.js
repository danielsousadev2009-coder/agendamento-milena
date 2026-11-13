import { z } from 'zod'

function stringField({ max, maxMessage, min, minMessage, trim = true, allowBlank = false } = {}) {
  let schema = z.string({
    error: (issue) => issue.input === undefined
      ? 'Este campo é obrigatório.'
      : 'Um campo de texto era esperado.',
  })
  if (trim) schema = schema.trim()
  if (!allowBlank) schema = schema.min(1, 'Este campo não pode ficar em branco.')
  if (max !== undefined) schema = schema.max(max, maxMessage)
  if (min !== undefined) schema = schema.min(min, minMessage)
  return z.preprocess((value) => {
    if (typeof value === 'string') return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return value
  }, schema)
}

const normalizeWhitespace = (value) => value.trim().replace(/\s+/gu, ' ')
const cpfDigits = (value) => value.replace(/\D/gu, '')

function isValidCpf(value) {
  if (value.length !== 11 || /^(\d)\1{10}$/u.test(value)) return false
  const digit = (length) => {
    let sum = 0
    for (let index = 0; index < length; index += 1) {
      sum += Number(value[index]) * (length + 1 - index)
    }
    const result = (sum * 10) % 11
    return (result === 10 ? 0 : result) === Number(value[length])
  }
  return digit(9) && digit(10)
}

const cpfSchema = stringField({
  max: 20,
  maxMessage: 'Certifique-se de que este campo tenha no máximo 20 caracteres.',
})
  .refine((value) => /^[0-9.\-\s]+$/u.test(value), 'Informe um CPF válido.')
  .transform(cpfDigits)
  .refine(isValidCpf, 'Informe um CPF válido.')

function collectIssues(issues) {
  const errors = {}
  for (const issue of issues) {
    const field = issue.path[0]
    if (typeof field !== 'string') {
      errors.detail = 'Esperava um objeto JSON.'
      continue
    }
    errors[field] ??= [issue.message]
  }
  return errors
}

function parse(schema, body) {
  const result = schema.safeParse(body)
  if (result.success) return result.data
  const error = new Error('Os dados enviados são inválidos.')
  error.status = 400
  error.responseBody = collectIssues(result.error.issues)
  throw error
}

const requestCreateSchema = z.object({
  full_name: stringField({
    max: 160,
    maxMessage: 'Certifique-se de que este campo tenha no máximo 160 caracteres.',
  })
    .transform(normalizeWhitespace)
    .refine((value) => value.split(' ').filter(Boolean).length >= 2, 'Informe seu nome completo.'),
  cpf: cpfSchema,
  classroom: stringField({
    max: 80,
    maxMessage: 'Certifique-se de que este campo tenha no máximo 80 caracteres.',
  })
    .transform(normalizeWhitespace)
    .refine((value) => /^\d+$/u.test(value), 'Informe apenas números para a sala.'),
})

const publicIdentitySchema = z.object({
  protocol: stringField({
    min: 1,
    minMessage: 'Este campo não pode ficar em branco.',
    max: 40,
    maxMessage: 'Certifique-se de que este campo tenha no máximo 40 caracteres.',
  }),
  cpf: cpfSchema,
})

const urgencyCreateSchema = publicIdentitySchema.extend({
  description: stringField({
    min: 10,
    minMessage: 'Certifique-se de que este campo tenha no mínimo 10 caracteres.',
    max: 2000,
    maxMessage: 'Certifique-se de que este campo tenha no máximo 2000 caracteres.',
  }),
})

const requestStatusSchema = z.object({
  status: z.enum(['waiting', 'review', 'in_progress', 'completed', 'cancelled'], {
    error: 'Selecione uma opção válida.',
  }).optional(),
  contact_status: z.enum(['not_started', 'contacted', 'awaiting_response'], {
    error: 'Selecione uma opção válida.',
  }).optional(),
  contact_note: stringField({
    max: 500,
    maxMessage: 'Certifique-se de que este campo tenha no máximo 500 caracteres.',
    allowBlank: true,
  }).optional(),
  queue_position: z.preprocess((value) => {
    if (typeof value === 'number' && Number.isInteger(value)) return value
    if (typeof value === 'string' && /^-?\d+$/u.test(value)) return Number(value)
    return value
  }, z.number({
    error: 'Informe um número inteiro válido.',
  }).int('Informe um número inteiro válido.')
    .min(1, 'Certifique-se de que este valor seja maior ou igual a 1.')).optional(),
  reason: stringField({
    max: 500,
    maxMessage: 'Certifique-se de que este campo tenha no máximo 500 caracteres.',
    allowBlank: true,
  }).optional(),
})

const urgencyEvaluationSchema = z.object({
  evaluation: z.enum(['confirmed', 'not_urgent', 'more_info'], {
    error: (issue) => issue.input === undefined ? 'Este campo é obrigatório.' : 'Selecione uma opção válida.',
  }),
  reason: stringField({
    max: 500,
    maxMessage: 'Certifique-se de que este campo tenha no máximo 500 caracteres.',
    allowBlank: true,
  }).optional(),
})

export function validateRequestCreate(body) {
  return parse(requestCreateSchema, body)
}

export function validatePublicIdentity(body) {
  return parse(publicIdentitySchema, body)
}

export function validateUrgencyCreate(body) {
  return parse(urgencyCreateSchema, body)
}

export function validateRequestStatus(body) {
  return parse(requestStatusSchema, body)
}

export function validateUrgencyEvaluation(body) {
  return parse(urgencyEvaluationSchema, body)
}

export function validateAdminCredentials(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { username: '', password: '' }
  }
  return {
    username: String(body.username ?? '').slice(0, 150),
    password: String(body.password ?? ''),
  }
}

export function normalizeCpf(value) {
  return cpfDigits(value)
}
