import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { pool } from '../server/config/database.js'
import * as authRepository from '../server/repositories/auth.js'
import * as requestRepository from '../server/repositories/requests.js'
import { cpfDigest, decryptValue, encryptValue, validateCpf } from '../server/utils/crypto.js'

const enabled = process.env.RUN_DB_INTEGRATION === 'true'

test('existing Supabase schema supports Node CRUD within a rolled-back transaction', { skip: !enabled }, async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    assert.equal((await client.query('SELECT 1 AS connected')).rows[0].connected, 1)

    const schema = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN (
           'auth_user', 'django_session', 'requests_app_auditevent',
           'requests_app_counselingrequest', 'requests_app_psychologistaccount',
           'requests_app_queuecounter', 'requests_app_urgencyrequest'
         )`,
    )
    assert.equal(schema.rows.length, 7)

    const cpf = '52998224725'
    assert.equal(validateCpf(cpf), cpf)
    const counter = await requestRepository.lockQueueCounter(client)
    const queueOrder = Number(counter.last_order) + 1
    await requestRepository.updateQueueCounter(client, queueOrder)
    const request = await requestRepository.insertRequest(client, {
      full_name: 'Teste Node Rollback',
      cpf,
      cpf_ciphertext: encryptValue(cpf),
      cpf_digest: cpfDigest(cpf),
      classroom: 'Turma de teste',
      protocol: `NODE-${randomBytes(12).toString('hex')}`,
      queue_order: queueOrder,
    })
    await requestRepository.insertAudit(client, {
      request_id: request.id,
      action: 'request_created',
      new_state: { status: request.status, queue_order: queueOrder },
    })
    const found = await requestRepository.findRequestByProtocol(client, request.protocol)
    assert.equal(found.id, request.id)
    assert.equal(decryptValue(found.cpf_ciphertext), cpf)
    const requestDetails = await requestRepository.findRequestById(client, request.id)
    assert.equal(requestDetails.protocol, request.protocol)
    requestDetails.status = 'review'
    requestDetails.contact_status = 'contacted'
    requestDetails.contacted_at = new Date()
    requestDetails.contact_note = 'Nota de teste'
    await requestRepository.updateRequestRow(client, requestDetails)
    await requestRepository.insertAudit(client, {
      request_id: request.id,
      action: 'request_updated',
      previous_state: { status: 'waiting' },
      new_state: { status: 'review' },
    })
    assert.equal((await requestRepository.listRequestHistory(client, request.id)).length, 2)

    const urgency = await requestRepository.insertUrgency(client, request.id, encryptValue('Teste de urgência com rollback'))
    await requestRepository.insertAudit(client, {
      request_id: request.id,
      urgency_id: urgency.id,
      action: 'urgency_submitted',
      new_state: { evaluation: urgency.evaluation },
    })
    await requestRepository.updateUrgency(client, {
      id: urgency.id,
      evaluation: 'confirmed',
      reason: 'Avaliação de teste',
    }, null)
    await requestRepository.insertAudit(client, {
      request_id: request.id,
      urgency_id: urgency.id,
      action: 'urgency_evaluated',
      previous_state: { evaluation: 'pending' },
      new_state: { evaluation: 'confirmed' },
      reason: 'Avaliação de teste',
    })
    assert.equal((await requestRepository.findUrgencyById(client, urgency.id)).evaluation, 'confirmed')
    assert.equal((await requestRepository.listUrgencyHistory(client, urgency.id)).length, 2)
    assert.equal((await requestRepository.listUrgencies(client, '')).some((item) => item.id === urgency.id), true)
    assert.equal((await requestRepository.countPendingUrgencies(client)) >= 0, true)
    assert.ok((await requestRepository.getRequestCounts(client)).review >= 1)
    assert.equal((await requestRepository.listRequests(client)).some((item) => item.id === request.id), true)

    const rateLimitKey = `rl_${randomBytes(16).toString('hex')}`
    assert.equal((await authRepository.consumeRateLimit(client, rateLimitKey, 2, 60_000)).allowed, true)
    assert.equal((await authRepository.consumeRateLimit(client, rateLimitKey, 2, 60_000)).allowed, true)
    assert.equal((await authRepository.consumeRateLimit(client, rateLimitKey, 2, 60_000)).allowed, false)

    const activeUser = await client.query(
      `SELECT u.id, u.email FROM auth_user AS u
       JOIN requests_app_psychologistaccount AS p ON p.user_id = u.id
       WHERE u.is_active = TRUE AND p.active = TRUE LIMIT 1`,
    )
    assert.equal(await authRepository.findPsychologistByEmail(client, `node-test-${randomBytes(8).toString('hex')}@example.test`), null)
    if (activeUser.rows[0]) {
      assert.ok(activeUser.rows[0].email)
      const psychologist = await authRepository.findPsychologistByEmail(client, activeUser.rows[0].email)
      assert.equal(String(psychologist.id), String(activeUser.rows[0].id))
      const sessionKey = randomBytes(24).toString('base64url')
      await authRepository.createSession(client, sessionKey, activeUser.rows[0].id, new Date(Date.now() + 60_000))
      const session = await authRepository.findActivePsychologistSession(client, sessionKey)
      assert.equal(String(session.id), String(activeUser.rows[0].id))
    }
  } finally {
    await client.query('ROLLBACK')
    client.release()
    await pool.end()
  }
})
