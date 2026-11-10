export async function findPsychologistByUsername(client, username) {
  const result = await client.query(
    `SELECT u.id, u.password, u.is_active, p.id AS profile_id, p.active AS profile_active
     FROM auth_user AS u
     JOIN requests_app_psychologistaccount AS p ON p.user_id = u.id
     WHERE u.username = $1 LIMIT 1`,
    [username],
  )
  return result.rows[0] ?? null
}

export async function updateLastLogin(client, userId, profileId) {
  await client.query('UPDATE auth_user SET last_login = NOW() WHERE id = $1', [userId])
  await client.query(
    'UPDATE requests_app_psychologistaccount SET last_login_at = NOW() WHERE id = $1',
    [profileId],
  )
}

export async function findActivePsychologistSession(client, sessionKey) {
  const result = await client.query(
    `SELECT s.session_data, u.id, u.is_active, p.active AS profile_active
     FROM django_session AS s
     JOIN auth_user AS u ON u.id = (s.session_data::jsonb ->> 'user_id')::bigint
     JOIN requests_app_psychologistaccount AS p ON p.user_id = u.id
     WHERE s.session_key = $1 AND s.expire_date > NOW()`,
    [sessionKey],
  )
  return result.rows[0] ?? null
}

export async function createSession(client, sessionKey, userId, expiresAt) {
  await client.query(
    `INSERT INTO django_session (session_key, session_data, expire_date)
     VALUES ($1, $2, $3)`,
    [sessionKey, JSON.stringify({ node_session: true, user_id: String(userId) }), expiresAt],
  )
}

export async function deleteSession(client, sessionKey) {
  await client.query('DELETE FROM django_session WHERE session_key = $1', [sessionKey])
}

export async function consumeRateLimit(client, sessionKey, maxRequests, windowMs) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + windowMs)
  await client.query(
    `INSERT INTO django_session (session_key, session_data, expire_date)
     VALUES ($1, '[]', $2)
     ON CONFLICT (session_key) DO NOTHING`,
    [sessionKey, expiresAt],
  )
  const current = await client.query(
    'SELECT session_data, expire_date FROM django_session WHERE session_key = $1 FOR UPDATE',
    [sessionKey],
  )
  const row = current.rows[0]
  let timestamps = new Date(row.expire_date) <= now ? [] : JSON.parse(row.session_data)
  timestamps = timestamps.filter((timestamp) => now.getTime() - timestamp < windowMs)
  const allowed = timestamps.length < maxRequests
  const retryAfterMs = allowed ? 0 : windowMs - (now.getTime() - timestamps[0])

  if (allowed) timestamps.push(now.getTime())
  await client.query(
    'UPDATE django_session SET session_data = $2, expire_date = $3 WHERE session_key = $1',
    [sessionKey, JSON.stringify(timestamps), expiresAt],
  )
  return { allowed, retryAfterMs }
}
