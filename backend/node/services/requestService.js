import {
  countPendingUrgencies,
  createCounselingRequest,
  createUrgencyRequest,
  evaluateUrgency,
  findCounselingRequestByProtocol,
  findCounselingRequestByCpfDigest,
  getQueuePosition,
  getRequestCounts,
  getRequestDetails,
  getUrgencyHistory,
  listCounselingRequests,
  listUrgencyRequests,
  updateCounselingRequest,
} from '../models/requestRepository.js'
import { cpfDigest, decryptValue, encryptValue, maskCpf, safeCompare } from '../security/crypto.js'

const ACTIVE_STATUSES = new Set(['waiting', 'review', 'in_progress'])

function queryValue(query, name) {
  const value = query[name]
  if (Array.isArray(value)) return String(value.at(-1) ?? '')
  return typeof value === 'string' ? value : ''
}

export async function createRequest(db, data, env) {
  const digest = cpfDigest(data.cpf, env)
  return createCounselingRequest(db, {
    fullName: data.full_name,
    cpfDigest: digest,
    classroom: data.classroom,
    ciphertext: encryptValue(data.cpf, env),
  })
}

export async function findPublicRequest(db, { protocol, cpf }, env) {
  const request = await findCounselingRequestByProtocol(db, protocol)
  if (!request) return null
  const digest = cpfDigest(cpf, env)
  return safeCompare(request.cpf_digest, digest) ? request : null
}

export async function findPublicRequestByCpf(db, cpf, env) {
  const digest = cpfDigest(cpf, env)
  const request = await findCounselingRequestByCpfDigest(db, digest)
  return request && safeCompare(request.cpf_digest, digest) ? request : null
}

export async function getPublicStatus(db, request) {
  const position = ACTIVE_STATUSES.has(request.status)
    ? await getQueuePosition(db, request.queue_order)
    : null
  return {
    status: request.status,
    queue_position: position,
    ...(request.completed_at ? { completed_at: request.completed_at } : {}),
  }
}

export async function createUrgency(db, request, description, env) {
  return createUrgencyRequest(db, {
    requestId: request.id,
    ciphertext: encryptValue(description, env),
  })
}

export async function getDashboard(db, query) {
  const [allRequests, counts, pendingUrgencies] = await Promise.all([
    listCounselingRequests(db),
    getRequestCounts(db),
    countPendingUrgencies(db),
  ])
  const positions = new Map()
  let position = 0
  for (const request of allRequests) {
    if (ACTIVE_STATUSES.has(request.status)) {
      position += 1
      positions.set(request.id, position)
    }
  }

  const callList = allRequests
    .filter((request) => positions.has(request.id))
    .map((request) => ({
      id: request.id,
      full_name: request.full_name,
      classroom: request.classroom,
      received_at: request.received_at,
      status: request.status,
      contact_status: request.contact_status,
      queue_position: positions.get(request.id),
    }))

  const search = queryValue(query, 'q').trim().slice(0, 100).toLowerCase()
  const classroom = queryValue(query, 'classroom').trim().slice(0, 80).toLowerCase()
  const status = queryValue(query, 'status').trim()
  const requests = allRequests
    .filter((request) => !search
      || request.full_name.toLowerCase().includes(search)
      || request.classroom.toLowerCase().includes(search))
    .filter((request) => !classroom || request.classroom.toLowerCase().includes(classroom))
    .filter((request) => !status || request.status === status)
    .map((request) => ({
      id: request.id,
      full_name: request.full_name,
      classroom: request.classroom,
      received_at: request.received_at,
      protocol: request.protocol,
      status: request.status,
      queue_position: positions.get(request.id) ?? null,
      contact_status: request.contact_status,
    }))

  return { counts, pending_urgencies: pendingUrgencies, call_list: callList, requests }
}

export async function getRequestDetail(db, id, env) {
  const request = await getRequestDetails(db, id)
  if (!request) return null
  return {
    id: request.id,
    full_name: request.full_name,
    classroom: request.classroom,
    cpf_masked: maskCpf(decryptValue(request.cpf_ciphertext, env)),
    protocol: request.protocol,
    status: request.status,
    contact_status: request.contact_status,
    contacted_at: request.contacted_at,
    completed_at: request.completed_at,
    contact_note: request.contact_note,
    received_at: request.received_at,
    history: request.history,
  }
}

export async function updateRequest(db, id, data, actorId) {
  if (Object.hasOwn(data, 'queue_position') && !data.reason?.trim()) {
    const error = new Error('Informe uma justificativa para alterar a ordem da fila.')
    error.status = 400
    error.responseBody = { detail: error.message }
    throw error
  }
  return updateCounselingRequest(db, { id, data, actorId })
}

export async function getUrgencies(db, evaluation, env) {
  const urgencies = await listUrgencyRequests(db, evaluation)
  return urgencies.map((urgency) => ({
    id: urgency.id,
    request_id: urgency.request_id,
    student_name: urgency.student_name,
    classroom: urgency.classroom,
    protocol: urgency.protocol,
    description: decryptValue(urgency.description_ciphertext, env),
    submitted_at: urgency.submitted_at,
    evaluation: urgency.evaluation,
    evaluated_at: urgency.evaluated_at,
    reason: urgency.reason,
  }))
}

export async function reviewUrgency(db, id, data, actorId) {
  return evaluateUrgency(db, {
    id,
    evaluation: data.evaluation,
    reason: data.reason ?? '',
    actorId,
  })
}

export async function getUrgencyAuditHistory(db, id) {
  return getUrgencyHistory(db, id)
}
