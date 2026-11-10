import { validateCpf } from '../utils/crypto.js'

const requestStatuses = ['waiting', 'review', 'in_progress', 'completed', 'cancelled']
const contactStatuses = ['not_started', 'contacted', 'awaiting_response']
const urgencyEvaluations = ['confirmed', 'not_urgent', 'more_info']

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function addError(errors, field, message) {
  errors[field] = [message]
}

function text(value, field, errors, { maxLength, trim = true, required = false, allowBlank = false } = {}) {
  if (typeof value !== 'string') {
    if (required) addError(errors, field, 'Este campo é obrigatório.')
    else addError(errors, field, 'Um texto válido é obrigatório.')
    return ''
  }
  const normalized = trim ? value.trim() : value
  if (required && !normalized) addError(errors, field, 'Este campo não pode ficar em branco.')
  if (!allowBlank && !required && !normalized) addError(errors, field, 'Este campo não pode ficar em branco.')
  if (maxLength && normalized.length > maxLength) addError(errors, field, `Certifique-se de que este campo não tenha mais de ${maxLength} caracteres.`)
  return normalized
}

function cpf(value, field, errors) {
  const candidate = text(value, field, errors, { maxLength: 14, required: true })
  if (!/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(candidate)) {
    if (!errors[field]) addError(errors, field, 'Informe um CPF válido, usando somente números.')
    return null
  }
  const normalized = validateCpf(candidate)
  if (!normalized && !errors[field]) addError(errors, field, 'Informe um CPF válido.')
  return normalized
}

function finish(errors, values) {
  if (Object.keys(errors).length) return { errors }
  return { values }
}

export function validateRequestCreate(body) {
  const errors = {}
  if (!isRecord(body)) return { errors: { detail: ['Esperado um objeto JSON.'] } }

  const fullName = text(body.full_name, 'full_name', errors, { maxLength: 160, required: true })
  const normalizedName = fullName.split(/\s+/).filter(Boolean).join(' ')
  if (normalizedName && normalizedName.split(' ').length < 2) addError(errors, 'full_name', 'Informe seu nome completo.')
  const identity = cpf(body.cpf, 'cpf', errors)
  const classroom = text(body.classroom, 'classroom', errors, { maxLength: 80, required: true })
  return finish(errors, { full_name: normalizedName, cpf: identity, classroom: classroom.split(/\s+/).filter(Boolean).join(' ') })
}

export function validatePrivateIdentity(body) {
  const errors = {}
  if (!isRecord(body)) return { errors: { detail: ['Esperado um objeto JSON.'] } }
  const protocol = text(body.protocol, 'protocol', errors, { maxLength: 40, required: true })
  const identity = cpf(body.cpf, 'cpf', errors)
  return finish(errors, { protocol, cpf: identity })
}

export function validateUrgencyCreate(body) {
  const identity = validatePrivateIdentity(body)
  if (identity.errors) return identity
  const errors = {}
  const description = text(body.description, 'description', errors, { maxLength: 2000, required: true })
  if (description && description.length < 10) addError(errors, 'description', 'Certifique-se de que este campo tenha pelo menos 10 caracteres.')
  return finish(errors, { ...identity.values, description })
}

export function validateRequestUpdate(body) {
  const errors = {}
  if (!isRecord(body)) return { errors: { detail: ['Esperado um objeto JSON.'] } }
  const values = {}

  if (Object.hasOwn(body, 'status')) {
    if (!requestStatuses.includes(body.status)) addError(errors, 'status', 'Selecione uma opção válida.')
    else values.status = body.status
  }
  if (Object.hasOwn(body, 'contact_status')) {
    if (!contactStatuses.includes(body.contact_status)) addError(errors, 'contact_status', 'Selecione uma opção válida.')
    else values.contact_status = body.contact_status
  }
  if (Object.hasOwn(body, 'contact_note')) values.contact_note = text(body.contact_note, 'contact_note', errors, { maxLength: 500, allowBlank: true })
  if (Object.hasOwn(body, 'queue_position')) {
    const rawPosition = body.queue_position
    const position = typeof rawPosition === 'string' && /^[+-]?\d+$/.test(rawPosition.trim())
      ? Number(rawPosition)
      : rawPosition
    if (!Number.isSafeInteger(position) || position < 1) addError(errors, 'queue_position', 'Certifique-se de que este valor seja maior ou igual a 1.')
    else values.queue_position = position
  }
  if (Object.hasOwn(body, 'reason')) values.reason = text(body.reason, 'reason', errors, { maxLength: 500, allowBlank: true })
  return finish(errors, values)
}

export function validateUrgencyEvaluation(body) {
  const errors = {}
  if (!isRecord(body)) return { errors: { detail: ['Esperado um objeto JSON.'] } }
  if (!Object.hasOwn(body, 'evaluation')) addError(errors, 'evaluation', 'Este campo é obrigatório.')
  else if (!urgencyEvaluations.includes(body.evaluation)) addError(errors, 'evaluation', 'Selecione uma opção válida.')
  const reason = Object.hasOwn(body, 'reason')
    ? text(body.reason, 'reason', errors, { maxLength: 500, allowBlank: true })
    : ''
  return finish(errors, { evaluation: body.evaluation, reason })
}
