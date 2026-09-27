// Sign-in with a phone number, without an SMS provider: a member who has a
// phone but no e-mail gets an auth login on a derived address that can never
// receive mail (.invalid is reserved, RFC 2606). The login form turns what
// was typed into that address when it looks like a phone number. Their
// public.users row keeps the phone and no e-mail.
export const PHONE_LOGIN_DOMAIN = 'phone.invalid'

// Same normalization as the Excel import: 06/07/05… become +212…, 00… become +…
export function normalizePhone(v: string) {
  let s = v.replace(/[^\d+]/g, '')
  if (!s) return ''
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  if (/^0[5-7]\d{8}$/.test(s)) s = `+212${s.slice(1)}`
  if (/^[5-7]\d{8}$/.test(s)) s = `+212${s}` // typed without the leading 0
  return s
}

export const phoneLoginEmail = (phone: string) => `${normalizePhone(phone).replace(/\D/g, '')}@${PHONE_LOGIN_DOMAIN}`

// What the login form sends to Supabase: an e-mail as typed, or the derived address.
export function loginIdentifier(input: string) {
  const v = input.trim()
  if (v.includes('@')) return v
  return /^\+?[\d\s().-]{6,20}$/.test(v) ? phoneLoginEmail(v) : v
}
