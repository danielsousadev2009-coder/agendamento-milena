import { createClient } from '@supabase/supabase-js'
import { getSupabaseAuthConfig } from '../config/env.js'

export async function signInWithSupabase(email, password) {
  const { url, publishableKey } = getSupabaseAuthConfig()
  const client = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })

  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) {
    if (error.status === 400) return null
    throw error
  }

  const verifiedEmail = data.user?.email_confirmed_at ? data.user.email?.trim().toLowerCase() : null
  return verifiedEmail || null
}
