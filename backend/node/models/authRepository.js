import { createSessionId } from '../security/crypto.js'
import { withTransaction } from './transaction.js'

export async function findPsychologistByIdentifier(db, identifier) {
  const result = await db.query(
    `SELECT u.id, u.username, u.password, u.is_active, p.active AS psychologist_active
     FROM auth_user u
     JOIN requests_app_psychologistaccount p ON p.user_id = u.id
     WHERE u.username = $1 OR lower(u.email) = lower($1)
     ORDER BY CASE WHEN u.username = $1 THEN 0 ELSE 1 END
     LIMIT 2`,
    [identifier],
  )
  const [firstMatch] = result.rows
  if (!firstMatch) return null
  if (firstMatch.username === identifier) return firstMatch
  return result.rows.length === 1 ? firstMatch : null
}

export async function findActivePsychologistSession(db, userId, sessionId) {
  const result = await db.query(
    `SELECT u.id, u.username
     FROM django_session s
     JOIN auth_user u ON u.id = $1
     JOIN requests_app_psychologistaccount p ON p.user_id = u.id
     WHERE s.session_key = $2
       AND s.expire_date > NOW()
       AND u.is_active = TRUE
       AND p.active = TRUE
     LIMIT 1`,
    [userId, sessionId],
  )
  return result.rows[0] ?? null
}

export function newSessionId() {
  return createSessionId()
}

export async function startPsychologistSession(db, { user, passwordHash, sessionId }) {
  return withTransaction(db, async (client) => {
    if (passwordHash) {
      await client.query(
        'UPDATE auth_user SET password = $1, last_login = NOW() WHERE id = $2',
        [passwordHash, user.id],
      )
    } else {
      await client.query('UPDATE auth_user SET last_login = NOW() WHERE id = $1', [user.id])
    }

    await client.query(
      'UPDATE requests_app_psychologistaccount SET last_login_at = NOW() WHERE user_id = $1',
      [user.id],
    )
    await client.query(
      "DELETE FROM django_session WHERE left(session_key, 3) <> 'rl_' AND expire_date <= NOW()",
    )
    await client.query(
      `INSERT INTO django_session (session_key, session_data, expire_date)
       VALUES ($1, '{}', NOW() + INTERVAL '14 days')`,
      [sessionId],
    )
  })
}

export async function endPsychologistSession(db, sessionId) {
  await db.query('DELETE FROM django_session WHERE session_key = $1', [sessionId])
}
