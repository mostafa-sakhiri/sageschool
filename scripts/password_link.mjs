// A one-time link to choose a new password (1 h), for any account, without
// sending an e-mail: for an admin who can't sign in any more, or an address
// that doesn't receive mail. The same link the office creates from the app
// (key button in Team / Parents), for when no one can sign in.
//
// Run it in your own terminal (the secret key must not end up in a chat or a
// file you commit):
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SECRET_KEY=<secret key> \
//   SITE_URL=https://<your site> \
//   node scripts/password_link.mjs someone@example.com
//
// Locally, SUPABASE_URL=http://127.0.0.1:54321 and SITE_URL=http://localhost:3000.
import { createClient } from '@supabase/supabase-js'

const [email] = process.argv.slice(2)
const { SUPABASE_URL, SUPABASE_SECRET_KEY, SITE_URL } = process.env
if (!email || !SUPABASE_URL || !SUPABASE_SECRET_KEY || !SITE_URL) {
  console.error('Usage: SUPABASE_URL=… SUPABASE_SECRET_KEY=… SITE_URL=… node scripts/password_link.mjs <e-mail>')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
if (error) {
  console.error(`Error: ${error.message}`)
  process.exit(1)
}
console.log(`${SITE_URL.replace(/\/$/, '')}/reset-password?token_hash=${encodeURIComponent(data.properties.hashed_token)}`)
console.log('One-time link, valid for 1 hour.')
