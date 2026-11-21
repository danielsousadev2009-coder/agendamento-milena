import { randomBytes } from 'node:crypto'
import { withTransaction } from './transaction.js'

const ACTIVE_STATUSES = ['waiting', 'review', 'in_progress']

function asNumber(value) {
  return value === null || value === undefined ? value : Number(value)
}

function createProtocol() {
  return `AC-${randomBytes(16).toString('base64url')}`
}

export async function createCounselingRequest(db, { fullName, cpfDigest, classroom, ciphertext }) {
  return withTransaction(db, async (client) => {
    const counter = await client.query(
      'SELECT last_order FROM requests_app_queuecounter WHERE id = 1 FOR UPDATE',
    )
    if (!counter.rowCount) {
      throw new Error('O contador da fila não foi inicializado no banco legado.')
    }

    const activeRequest = await client.query(
      'SELECT id FROM requests_app_counselingrequest WHERE active_cpf_digest = $1 LIMIT 1',
      [cpfDigest],
    )
    if (activeRequest.rowCount) {
      const error = new Error('Você já possui uma solicitação ativa. Consulte o andamento usando o CPF informado.')
      error.code = 'ACTIVE_REQUEST_EXISTS'
      throw error
    }

    const queueOrder = asNumber(counter.rows[0].last_order) + 1
    await client.query(
      'UPDATE requests_app_queuecounter SET last_order = $1 WHERE id = 1',
      [queueOrder],
    )
    const inserted = await client.query(
      `INSERT INTO requests_app_counselingrequest
         (full_name, cpf_ciphertext, cpf_digest, active_cpf_digest, classroom, protocol,
          received_at, updated_at, status, completed_at, queue_order, contact_status,
          contacted_at, contact_note)
       VALUES ($1, $2, $3, $3, $4, $5, NOW(), NOW(), 'waiting', NULL, $6,
               'not_started', NULL, '')
       RETURNING id, protocol, status`,
      [fullName, ciphertext, cpfDigest, classroom, createProtocol(), queueOrder],
    )
    const request = inserted.rows[0]
    await client.query(
      `INSERT INTO requests_app_auditevent
         (request_id, urgency_id, action, previous_state, new_state, reason, actor_id, created_at)
       VALUES ($1, NULL, 'request_created', '{}'::jsonb, $2::jsonb, '', NULL, NOW())`,
      [request.id, JSON.stringify({ status: request.status, queue_order: queueOrder })],
    )
    return { ...request, id: asNumber(request.id) }
  })
}

export async function findCounselingRequestByProtocol(db, protocol) {
  const result = await db.query(
    `SELECT id, full_name, cpf_ciphertext, cpf_digest, classroom, protocol, received_at,
            updated_at, status, completed_at, queue_order, contact_status, contacted_at, contact_note
     FROM requests_app_counselingrequest
     WHERE protocol = $1
     LIMIT 1`,
    [protocol],
  )
  const request = result.rows[0]
  return request ? { ...request, id: asNumber(request.id), queue_order: asNumber(request.queue_order) } : null
}

export async function findCounselingRequestByCpfDigest(db, digest) {
  const result = await db.query(
    `SELECT id, cpf_digest, status, queue_order, completed_at
     FROM requests_app_counselingrequest
     WHERE cpf_digest = $1
     ORDER BY CASE WHEN status IN ('waiting', 'review', 'in_progress') THEN 0 ELSE 1 END,
              received_at DESC
     LIMIT 1`,
    [digest],
  )
  const request = result.rows[0]
  return request ? { ...request, id: asNumber(request.id), queue_order: asNumber(request.queue_order) } : null
}

export async function getQueuePosition(db, queueOrder) {
  const result = await db.query(
    `SELECT COUNT(*)::integer AS position
     FROM requests_app_counselingrequest
     WHERE status = ANY($1::varchar[]) AND queue_order <= $2`,
    [ACTIVE_STATUSES, queueOrder],
  )
  return result.rows[0].position
}

export async function createUrgencyRequest(db, { requestId, ciphertext }) {
  return withTransaction(db, async (client) => {
    const inserted = await client.query(
      `INSERT INTO requests_app_urgencyrequest
         (request_id, description_ciphertext, submitted_at, evaluation, evaluated_at, reason, evaluator_id)
       VALUES ($1, $2, NOW(), 'pending', NULL, '', NULL)
       RETURNING id, evaluation`,
      [requestId, ciphertext],
    )
    const urgency = inserted.rows[0]
    await client.query(
      `INSERT INTO requests_app_auditevent
         (request_id, urgency_id, action, previous_state, new_state, reason, actor_id, created_at)
       VALUES ($1, $2, 'urgency_submitted', '{}'::jsonb, $3::jsonb, '', NULL, NOW())`,
      [requestId, urgency.id, JSON.stringify({ evaluation: urgency.evaluation })],
    )
    return { ...urgency, id: asNumber(urgency.id) }
  })
}

export async function listCounselingRequests(db) {
  const result = await db.query(
    `SELECT id, full_name, classroom, protocol, received_at, status,
            contact_status, queue_order
     FROM requests_app_counselingrequest
     ORDER BY queue_order, received_at`,
  )
  return result.rows.map((row) => ({
    ...row,
    id: asNumber(row.id),
    queue_order: asNumber(row.queue_order),
  }))
}

export async function getRequestCounts(db) {
  const result = await db.query(
    `SELECT status, COUNT(*)::integer AS total
     FROM requests_app_counselingrequest
     GROUP BY status`,
  )
  return Object.fromEntries(result.rows.map((row) => [row.status, row.total]))
}

export async function countPendingUrgencies(db) {
  const result = await db.query(
    `SELECT COUNT(*)::integer AS total
     FROM requests_app_urgencyrequest
     WHERE evaluation = 'pending'`,
  )
  return result.rows[0].total
}

export async function getRequestDetails(db, id) {
  const [requestResult, historyResult] = await Promise.all([
    db.query(
      `SELECT id, full_name, cpf_ciphertext, classroom, protocol, status, contact_status,
              contacted_at, contact_note, received_at, completed_at
       FROM requests_app_counselingrequest
       WHERE id = $1
       LIMIT 1`,
      [id],
    ),
    db.query(
      `SELECT action, previous_state, new_state, reason, created_at
       FROM requests_app_auditevent
       WHERE request_id = $1
       ORDER BY created_at DESC`,
      [id],
    ),
  ])
  const request = requestResult.rows[0]
  if (!request) return null
  return { ...request, id: asNumber(request.id), history: historyResult.rows }
}

export async function updateCounselingRequest(db, { id, data, actorId }) {
  const updated = await withTransaction(db, async (client) => {
    if (Object.hasOwn(data, 'queue_position')) {
      const counter = await client.query(
        'SELECT id FROM requests_app_queuecounter WHERE id = 1 FOR UPDATE',
      )
      if (!counter.rowCount) {
        throw new Error('O contador da fila não foi inicializado no banco legado.')
      }
    }
    const result = await client.query(
      `SELECT id, status, contact_status, contact_note, cpf_digest, queue_order
       FROM requests_app_counselingrequest
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const request = result.rows[0]
    if (!request) return false

    const previous = {
      status: request.status,
      contact_status: request.contact_status,
      queue_order: asNumber(request.queue_order),
    }
    const next = {
      status: request.status,
      contact_status: request.contact_status,
      contact_note: request.contact_note,
      queue_order: asNumber(request.queue_order),
    }
    for (const field of ['status', 'contact_status', 'contact_note']) {
      if (Object.hasOwn(data, field)) next[field] = data[field]
    }
    const changed = ['status', 'contact_status', 'contact_note'].filter((field) => next[field] !== request[field])
    let activeDigest = undefined
    let completedAt = undefined
    let contactedAt = undefined
    if (changed.includes('status')) {
      activeDigest = ['completed', 'cancelled'].includes(next.status) ? null : request.cpf_digest
      completedAt = next.status === 'completed' ? new Date() : null
    }
    if (changed.includes('contact_status')) {
      contactedAt = next.contact_status === 'contacted' ? new Date() : null
    }

    await client.query(
      `UPDATE requests_app_counselingrequest
       SET status = $1,
           contact_status = $2,
           contact_note = $3,
           active_cpf_digest = CASE WHEN $4::boolean THEN $5 ELSE active_cpf_digest END,
           completed_at = CASE WHEN $6::boolean THEN $7::timestamptz ELSE completed_at END,
           contacted_at = CASE WHEN $8::boolean THEN $9::timestamptz ELSE contacted_at END,
           updated_at = NOW()
       WHERE id = $10`,
      [
        next.status,
        next.contact_status,
        next.contact_note,
        changed.includes('status'),
        activeDigest,
        changed.includes('status'),
        completedAt,
        changed.includes('contact_status'),
        contactedAt,
        id,
      ],
    )

    if (changed.length) {
      await client.query(
        `INSERT INTO requests_app_auditevent
           (request_id, urgency_id, action, previous_state, new_state, reason, actor_id, created_at)
         VALUES ($1, NULL, 'request_updated', $2::jsonb, $3::jsonb, $4, $5, NOW())`,
        [
          id,
          JSON.stringify(previous),
          JSON.stringify({
            status: next.status,
            contact_status: next.contact_status,
            queue_order: next.queue_order,
          }),
          data.reason ?? '',
          actorId,
        ],
      )
    }

    if (Object.hasOwn(data, 'queue_position')) {
      const activeResult = await client.query(
        `SELECT id
         FROM requests_app_counselingrequest
         WHERE status = ANY($1::varchar[])
         ORDER BY queue_order, received_at
         FOR UPDATE`,
        [ACTIVE_STATUSES],
      )
      const activeIds = activeResult.rows.map((row) => asNumber(row.id))
      const requestPosition = activeIds.indexOf(asNumber(id))
      if (requestPosition < 0 || data.queue_position > activeIds.length) {
        const error = new Error('A posição informada não está disponível na fila ativa.')
        error.code = 'INVALID_QUEUE_POSITION'
        throw error
      }

      const oldOrder = [...activeIds]
      activeIds.splice(requestPosition, 1)
      activeIds.splice(data.queue_position - 1, 0, asNumber(id))
      for (let index = 0; index < activeIds.length; index += 1) {
        await client.query(
          'UPDATE requests_app_counselingrequest SET queue_order = $1 WHERE id = $2',
          [index + 1, activeIds[index]],
        )
      }
      await client.query(
        `INSERT INTO requests_app_auditevent
           (request_id, urgency_id, action, previous_state, new_state, reason, actor_id, created_at)
         VALUES ($1, NULL, 'queue_reordered', $2::jsonb, $3::jsonb, $4, $5, NOW())`,
        [
          id,
          JSON.stringify({ order: oldOrder }),
          JSON.stringify({ order: activeIds, queue_order: data.queue_position }),
          data.reason ?? '',
          actorId,
        ],
      )
    }
    return true
  })
  return updated
}

export async function listUrgencyRequests(db, evaluation = '') {
  const result = await db.query(
    `SELECT u.id, u.request_id, r.full_name AS student_name, r.classroom, r.protocol,
            u.description_ciphertext, u.submitted_at, u.evaluation, u.evaluated_at, u.reason
     FROM requests_app_urgencyrequest u
     JOIN requests_app_counselingrequest r ON r.id = u.request_id
     WHERE ($1 = '' OR u.evaluation = $1)
     ORDER BY CASE WHEN u.evaluation = 'pending' THEN 0 ELSE 1 END, u.submitted_at`,
    [evaluation],
  )
  return result.rows.map((row) => ({
    ...row,
    id: asNumber(row.id),
    request_id: asNumber(row.request_id),
  }))
}

export async function evaluateUrgency(db, { id, evaluation, reason, actorId }) {
  return withTransaction(db, async (client) => {
    const result = await client.query(
      `SELECT id, request_id, evaluation
       FROM requests_app_urgencyrequest
       WHERE id = $1
       FOR UPDATE`,
      [id],
    )
    const urgency = result.rows[0]
    if (!urgency) return false
    await client.query(
      `UPDATE requests_app_urgencyrequest
       SET evaluation = $1, reason = $2, evaluated_at = NOW(), evaluator_id = $3
       WHERE id = $4`,
      [evaluation, reason, actorId, id],
    )
    await client.query(
      `INSERT INTO requests_app_auditevent
         (request_id, urgency_id, action, previous_state, new_state, reason, actor_id, created_at)
       VALUES ($1, $2, 'urgency_evaluated', $3::jsonb, $4::jsonb, $5, $6, NOW())`,
      [
        urgency.request_id,
        id,
        JSON.stringify({ evaluation: urgency.evaluation }),
        JSON.stringify({ evaluation }),
        reason,
        actorId,
      ],
    )
    return true
  })
}

export async function getUrgencyHistory(db, id) {
  const result = await db.query(
    `SELECT action, previous_state, new_state, reason, created_at
     FROM requests_app_auditevent
     WHERE urgency_id = $1
     ORDER BY created_at DESC`,
    [id],
  )
  return result.rows
}
