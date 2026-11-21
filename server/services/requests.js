import { timingSafeEqual } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { pool } from '../config/database.js'
import * as repository from '../repositories/requests.js'
import { cpfDigest, decryptValue, encryptValue, maskCpf } from '../utils/crypto.js'
import { inTransaction } from '../utils/database.js'

const activeStatuses = new Set(['waiting', 'review', 'in_progress'])
const duplicateRequestMessage = 'Você já possui uma solicitação ativa. Use o protocolo recebido para consultar o andamento.'

function isSameDigest(left, right) {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export async function createRequest(data) {
  const digest = cpfDigest(data.cpf)
  return inTransaction(async (client) => {
    if (await repository.findActiveRequestByDigest(client, digest)) {
      const error = new Error(duplicateRequestMessage)
      error.status = 409
      throw error
    }

    const counter = await repository.lockQueueCounter(client)
    const nextOrder = Number(counter.last_order) + 1
    await repository.updateQueueCounter(client, nextOrder)

    let request
    try {
      request = await repository.insertRequest(client, {
        ...data,
        cpf_ciphertext: encryptValue(data.cpf),
        cpf_digest: digest,
        protocol: `AC-${randomBytes(16).toString('base64url')}`,
        queue_order: nextOrder,
      })
    } catch (error) {
      if (error.code === '23505') {
        const duplicate = new Error(duplicateRequestMessage)
        duplicate.status = 409
        throw duplicate
      }
      throw error
    }

    await repository.insertAudit(client, {
      request_id: request.id,
      action: 'request_created',
      new_state: { status: request.status, queue_order: nextOrder },
    })
    return { ...request, id: Number(request.id) }
  })
}

export async function findPublicRequest(protocol, cpf) {
  const expectedDigest = cpfDigest(cpf)
  const request = await repository.findRequestByProtocol(pool, protocol)
  if (!request || !isSameDigest(request.cpf_digest, expectedDigest)) return null
  return request
}

export async function getRequestStatus(protocol, cpf) {
  const request = await findPublicRequest(protocol, cpf)
  if (!request) return null
  const position = activeStatuses.has(request.status)
    ? await repository.countQueuePosition(pool, request.queue_order)
    : null
  return { status: request.status, queue_position: position }
}

export async function createUrgency(protocol, cpf, description) {
  const request = await findPublicRequest(protocol, cpf)
  if (!request) return null

  return inTransaction(async (client) => {
    const urgency = await repository.insertUrgency(client, request.id, encryptValue(description))
    await repository.insertAudit(client, {
      request_id: request.id,
      urgency_id: urgency.id,
      action: 'urgency_submitted',
      new_state: { evaluation: urgency.evaluation },
    })
    return urgency
  })
}

export async function getDashboard(filters) {
  const [orders, counts, pendingUrgencies] = await Promise.all([
    repository.listRequests(pool),
    repository.getRequestCounts(pool),
    repository.countPendingUrgencies(pool),
  ])
  let position = 0
  const positions = new Map()
  for (const order of orders) {
    if (activeStatuses.has(order.status)) positions.set(String(order.id), ++position)
  }

  const query = filters.q.trim().slice(0, 100).toLocaleLowerCase()
  const classroom = filters.classroom.trim().slice(0, 80).toLocaleLowerCase()
  const status = filters.status.trim()
  const filtered = orders.filter((order) => {
    const matchesQuery = !query
      || order.full_name.toLocaleLowerCase().includes(query)
      || order.classroom.toLocaleLowerCase().includes(query)
    const matchesClassroom = !classroom || order.classroom.toLocaleLowerCase().includes(classroom)
    return matchesQuery && matchesClassroom && (!status || order.status === status)
  })

  return {
    counts,
    pending_urgencies: pendingUrgencies,
    call_list: orders
      .filter((order) => positions.has(String(order.id)))
      .map((order) => ({
        id: Number(order.id),
        full_name: order.full_name,
        classroom: order.classroom,
        received_at: order.received_at,
        status: order.status,
        contact_status: order.contact_status,
        queue_position: positions.get(String(order.id)),
      })),
    requests: filtered.map((order) => ({
      id: Number(order.id),
      full_name: order.full_name,
      classroom: order.classroom,
      received_at: order.received_at,
      protocol: order.protocol,
      status: order.status,
      queue_position: positions.get(String(order.id)) ?? null,
      contact_status: order.contact_status,
    })),
  }
}

export async function getUrgencies(evaluation) {
  const urgencies = await repository.listUrgencies(pool, evaluation)
  return {
    urgencies: urgencies.map((item) => ({
      id: Number(item.id),
      request_id: Number(item.request_id),
      student_name: item.full_name,
      classroom: item.classroom,
      protocol: item.protocol,
      description: decryptValue(item.description_ciphertext),
      submitted_at: item.submitted_at,
      evaluation: item.evaluation,
      evaluated_at: item.evaluated_at,
      reason: item.reason,
    })),
  }
}

export async function getRequestDetails(id) {
  const request = await repository.findRequestById(pool, id)
  if (!request) return null
  const history = await repository.listRequestHistory(pool, id)
  return {
    id: Number(request.id),
    full_name: request.full_name,
    classroom: request.classroom,
    cpf_masked: maskCpf(decryptValue(request.cpf_ciphertext)),
    protocol: request.protocol,
    status: request.status,
    contact_status: request.contact_status,
    contacted_at: request.contacted_at,
    contact_note: request.contact_note,
    received_at: request.received_at,
    history,
  }
}

async function reorderRequest(id, position, actorId, reason) {
  return inTransaction(async (client) => {
    const active = await repository.listActiveRequestsForReorder(client)
    const requestIndex = active.findIndex((item) => String(item.id) === String(id))
    if (requestIndex < 0 || position > active.length) {
      throw new Error('A posição informada não está disponível na fila ativa.')
    }

    const previous = active.map((item) => Number(item.id))
    const [request] = active.splice(requestIndex, 1)
    active.splice(position - 1, 0, request)
    for (const [index, item] of active.entries()) {
      await repository.updateQueueOrder(client, item.id, index + 1)
    }
    await repository.insertAudit(client, {
      request_id: id,
      action: 'queue_reordered',
      previous_state: { order: previous },
      new_state: { order: active.map((item) => Number(item.id)), queue_order: position },
      reason,
      actor_id: actorId,
    })
  })
}

export async function updateRequest(id, data, actorId) {
  const found = await inTransaction(async (client) => {
    const request = await repository.findRequestById(client, id)
    if (!request) return false

    const previous = {
      status: request.status,
      contact_status: request.contact_status,
      queue_order: Number(request.queue_order),
    }
    const changed = []
    for (const field of ['status', 'contact_status', 'contact_note']) {
      if (Object.hasOwn(data, field) && request[field] !== data[field]) {
        request[field] = data[field]
        changed.push(field)
      }
    }

    if (changed.includes('status')) {
      if (['completed', 'cancelled'].includes(request.status)) {
        request.active_cpf_digest = null
        request.completed_at = request.status === 'completed' ? new Date() : null
      } else {
        request.active_cpf_digest = request.cpf_digest
        request.completed_at = null
      }
    }
    if (changed.includes('contact_status')) {
      request.contacted_at = request.contact_status === 'contacted' ? new Date() : null
    }

    await repository.updateRequestRow(client, request)
    if (changed.length) {
      await repository.insertAudit(client, {
        request_id: id,
        action: 'request_updated',
        previous_state: previous,
        new_state: {
          status: request.status,
          contact_status: request.contact_status,
          queue_order: Number(request.queue_order),
        },
        reason: data.reason ?? '',
        actor_id: actorId,
      })
    }
    return true
  })
  if (!found) return false

  if (Object.hasOwn(data, 'queue_position')) {
    await reorderRequest(id, data.queue_position, actorId, data.reason ?? '')
  }
  return true
}

export async function evaluateUrgency(id, evaluation, reason, actorId) {
  return inTransaction(async (client) => {
    const urgency = await repository.findUrgencyById(client, id)
    if (!urgency) return false
    const previous = urgency.evaluation
    urgency.evaluation = evaluation
    urgency.reason = reason
    await repository.updateUrgency(client, urgency, actorId)
    await repository.insertAudit(client, {
      request_id: urgency.request_id,
      urgency_id: urgency.id,
      action: 'urgency_evaluated',
      previous_state: { evaluation: previous },
      new_state: { evaluation },
      reason,
      actor_id: actorId,
    })
    return true
  })
}

export async function getUrgencyHistory(id) {
  const history = await repository.listUrgencyHistory(pool, id)
  return history.length ? { history } : null
}
