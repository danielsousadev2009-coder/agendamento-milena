import { withTransaction } from './transaction.js'

export async function createPsychologistAccount(db, { username, passwordHash }) {
  return withTransaction(db, async (client) => {
    const activeAccount = await client.query(
      'SELECT id FROM requests_app_psychologistaccount WHERE active = TRUE LIMIT 1',
    )
    if (activeAccount.rowCount) {
      const error = new Error('Já existe uma conta administrativa ativa.')
      error.code = 'ACTIVE_PSYCHOLOGIST_EXISTS'
      throw error
    }

    const email = username.includes('@') ? username : ''
    const createdUser = await client.query(
      `INSERT INTO auth_user
         (password, last_login, is_superuser, username, first_name, last_name, email,
          is_staff, is_active, date_joined)
       VALUES ($1, NULL, FALSE, $2, '', '', $3, FALSE, TRUE, NOW())
       RETURNING id`,
      [passwordHash, username, email],
    )
    await client.query(
      `INSERT INTO requests_app_psychologistaccount
         (active, slot, created_at, last_login_at, user_id)
       VALUES (TRUE, 1, NOW(), NULL, $1)`,
      [createdUser.rows[0].id],
    )
    return createdUser.rows[0].id
  })
}
