export async function findActiveRequestByDigest(client, digest) {
  const result = await client.query(
    'SELECT id FROM requests_app_counselingrequest WHERE active_cpf_digest = $1 LIMIT 1',
    [digest],
  )
  return result.rows[0] ?? null
}

export async function lockQueueCounter(client) {
  const result = await client.query(
    'SELECT id, last_order FROM requests_app_queuecounter WHERE id = 1 FOR UPDATE',
  )
  if (!result.rows[0]) throw new Error('Queue counter row 1 is missing.')
  return result.rows[0]
}

export async function updateQueueCounter(client, lastOrder) {
  await client.query(
    'UPDATE requests_app_queuecounter SET last_order = $1 WHERE id = 1',
    [lastOrder],
  )
}

export async function insertRequest(client, data) {
  const result = await client.query(
    `INSERT INTO requests_app_counselingrequest
      (full_name, cpf_ciphertext, cpf_digest, active_cpf_digest, classroom, protocol,
       received_at, updated_at, status, queue_order, contact_status, contact_note)
     VALUES ($1, $2, $3, $3, $4, $5, NOW(), NOW(), 'waiting', $6, 'not_started', '')
     RETURNING id, protocol, status, queue_order`,
    [data.full_name, data.cpf_ciphertext, data.cpf_digest, data.classroom, data.protocol, data.queue_order],
  )
  return result.rows[0]
}

export async function insertAudit(client, data) {
  await client.query(
    `INSERT INTO requests_app_auditevent
      (request_id, urgency_id, action, previous_state, new_state, reason, actor_id, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, NOW())`,
    [
      data.request_id ?? null,
      data.urgency_id ?? null,
      data.action,
      JSON.stringify(data.previous_state ?? {}),
      JSON.stringify(data.new_state ?? {}),
      data.reason ?? '',
      data.actor_id ?? null,
    ],
  )
}

export async function findRequestByProtocol(client, protocol) {
  const result = await client.query(
    `SELECT id, protocol, full_name, cpf_ciphertext, cpf_digest, classroom, received_at,
      status, queue_order, contact_status, contacted_at, contact_note
     FROM requests_app_counselingrequest WHERE protocol = $1 LIMIT 1`,
    [protocol],
  )
  return result.rows[0] ?? null
}

export async function countQueuePosition(client, queueOrder) {
  const result = await client.query(
    `SELECT COUNT(*)::integer AS total
     FROM requests_app_counselingrequest
     WHERE status IN ('waiting', 'review', 'in_progress') AND queue_order <= $1`,
    [queueOrder],
  )
  return result.rows[0].total
}

export async function insertUrgency(client, requestId, encryptedDescription) {
  const result = await client.query(
    `INSERT INTO requests_app_urgencyrequest
      (request_id, description_ciphertext, submitted_at, evaluation, reason)
     VALUES ($1, $2, NOW(), 'pending', '')
     RETURNING id, evaluation`,
    [requestId, encryptedDescription],
  )
  return result.rows[0]
}

export async function listRequests(client) {
  const result = await client.query(
    `SELECT id, full_name, classroom, protocol, received_at,
      status, queue_order, contact_status, contacted_at, contact_note
     FROM requests_app_counselingrequest
     ORDER BY queue_order, received_at`,
  )
  return result.rows
}

export async function getRequestCounts(client) {
  const result = await client.query(
    `SELECT status, COUNT(*)::integer AS total
     FROM requests_app_counselingrequest GROUP BY status`,
  )
  return Object.fromEntries(result.rows.map((row) => [row.status, row.total]))
}

export async function countPendingUrgencies(client) {
  const result = await client.query(
    `SELECT COUNT(*)::integer AS total FROM requests_app_urgencyrequest WHERE evaluation = 'pending'`,
  )
  return result.rows[0].total
}

export async function listUrgencies(client, evaluation) {
  const result = await client.query(
    `SELECT u.id, u.request_id, r.full_name, r.classroom, r.protocol, u.description_ciphertext,
      u.submitted_at, u.evaluation, u.evaluated_at, u.reason
     FROM requests_app_urgencyrequest AS u
     JOIN requests_app_counselingrequest AS r ON r.id = u.request_id
     WHERE ($1 = '' OR u.evaluation = $1)
     ORDER BY (u.evaluation <> 'pending'), u.submitted_at`,
    [evaluation],
  )
  return result.rows
}

export async function findRequestById(client, id) {
  const result = await client.query(
    `SELECT id, full_name, cpf_ciphertext, cpf_digest, active_cpf_digest, completed_at, classroom,
      protocol, status, contact_status, contacted_at, contact_note, received_at, queue_order
     FROM requests_app_counselingrequest WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function listRequestHistory(client, id) {
  const result = await client.query(
    `SELECT action, previous_state, new_state, reason, created_at
     FROM requests_app_auditevent WHERE request_id = $1 ORDER BY created_at DESC`,
    [id],
  )
  return result.rows
}

export async function listActiveRequestsForReorder(client) {
  const result = await client.query(
    `SELECT id, queue_order, received_at FROM requests_app_counselingrequest
     WHERE status IN ('waiting', 'review', 'in_progress')
     ORDER BY queue_order, received_at FOR UPDATE`,
  )
  return result.rows
}

export async function updateQueueOrder(client, id, order) {
  await client.query(
    'UPDATE requests_app_counselingrequest SET queue_order = $2 WHERE id = $1',
    [id, order],
  )
}

export async function updateRequestRow(client, request) {
  await client.query(
    `UPDATE requests_app_counselingrequest
     SET status = $2, active_cpf_digest = $3, completed_at = $4, contact_status = $5,
       contacted_at = $6, contact_note = $7, updated_at = NOW()
     WHERE id = $1`,
    [
      request.id,
      request.status,
      request.active_cpf_digest,
      request.completed_at,
      request.contact_status,
      request.contacted_at,
      request.contact_note,
    ],
  )
}

export async function findUrgencyById(client, id) {
  const result = await client.query(
    `SELECT id, request_id, evaluation FROM requests_app_urgencyrequest WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function updateUrgency(client, urgency, actorId) {
  await client.query(
    `UPDATE requests_app_urgencyrequest
     SET evaluation = $2, reason = $3, evaluated_at = NOW(), evaluator_id = $4
     WHERE id = $1`,
    [urgency.id, urgency.evaluation, urgency.reason, actorId],
  )
}

export async function listUrgencyHistory(client, id) {
  const result = await client.query(
    `SELECT action, previous_state, new_state, reason, created_at
     FROM requests_app_auditevent WHERE urgency_id = $1 ORDER BY created_at DESC`,
    [id],
  )
  return result.rows
}
