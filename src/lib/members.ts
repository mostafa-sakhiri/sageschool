import { createServerFn } from '@tanstack/react-start'
import { createClient, createServiceClient } from './supabase/server'
import type { Role } from './session'

type InviteInput = {
  schoolId: string
  email: string
  fullName: string
  role: Role
  password?: string
  // role 'student': link the new login to this student record
  studentId?: string
}

function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `Ecole-${s}`
}

// Creates (or reuses) a login and adds it to the school with a role.
// Authorization happens here, before the secret key is used:
//   admin -> any role ; staff -> parent or student only.
// There is no e-mail delivery locally: the temporary password is returned
// for the office to hand over (DECISIONS.md D-008).
export const inviteMember = createServerFn({ method: 'POST' })
  .validator((d: InviteInput) => {
    const email = String(d.email ?? '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('E-mail invalide')
    if (!String(d.fullName ?? '').trim()) throw new Error('Nom obligatoire')
    if (!['admin', 'staff', 'teacher', 'parent', 'student'].includes(d.role)) throw new Error('Rôle invalide')
    return { ...d, email, fullName: d.fullName.trim() }
  })
  .handler(async ({ data }) => {
    const supabase = createClient()
    const { data: claims } = await supabase.auth.getClaims()
    if (!claims?.claims) throw new Error('Non authentifié')

    // Caller's own memberships, read through RLS with the caller's session
    const { data: me } = await supabase
      .from('users')
      .select('id')
      .eq('auth_provider_id', claims.claims.sub)
      .single()
    const { data: mine } = await supabase
      .from('school_members')
      .select('role')
      .eq('school_id', data.schoolId)
      .eq('user_id', me?.id ?? '')
      .eq('status', 'active')
    const roles = (mine ?? []).map((m) => m.role)
    const allowed =
      roles.includes('admin') || (roles.includes('staff') && ['parent', 'student'].includes(data.role))
    if (!allowed) throw new Error('Droits insuffisants pour ajouter ce rôle')

    const admin = createServiceClient()
    let password: string | null = null

    const { data: existing } = await admin
      .from('users')
      .select('id, auth_provider_id')
      .ilike('email', data.email)
      .maybeSingle()

    let userId = existing?.id as string | undefined
    if (!existing?.auth_provider_id) {
      password = data.password || tempPassword()
      const { error } = await admin.auth.admin.createUser({
        email: data.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      })
      if (error) throw new Error(error.message)
      const { data: created } = await admin.from('users').select('id').ilike('email', data.email).single()
      userId = created?.id
    }
    if (!userId) throw new Error('Utilisateur introuvable')

    // Idempotent: the same person may already hold this role here.
    const { data: member, error: memberError } = await admin
      .from('school_members')
      .upsert(
        { school_id: data.schoolId, user_id: userId, role: data.role, status: 'active' },
        { onConflict: 'school_id,user_id,role' },
      )
      .select('id')
      .single()
    if (memberError) throw new Error(memberError.message)

    if (data.role === 'student' && data.studentId) {
      // Through RLS: only the office can update student records.
      const { error } = await supabase
        .from('students')
        .update({ member_id: member.id })
        .eq('id', data.studentId)
        .eq('school_id', data.schoolId)
      if (error) throw new Error(error.message)
    }

    return { memberId: member.id as string, userId, password }
  })
