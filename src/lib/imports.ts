import { createServerFn } from '@tanstack/react-start'
import { createClient, createServiceClient } from './supabase/server'

// Bulk import of people from the suggested Excel formats (parsed and checked
// in the browser, re-checked here). Authorization first, then:
//  - logins and memberships: secret key (as inviteMember does);
//  - students, enrolments, classes, guardian links: the caller's own session,
//    so RLS still decides (staff can't create classes, for instance).

type StaffIn = { line: number; fullName: string; email: string; phone: string; role: 'teacher' | 'staff' | 'admin' }
type ParentIn = { fullName: string; email: string; phone: string; relationship: 'mother' | 'father' | 'guardian' | 'other' | null }
type StudentIn = {
  line: number
  firstName: string
  lastName: string
  birthDate: string | null
  gender: 'female' | 'male' | null
  massar: string
  level: string
  className: string
  parents: ParentIn[]
}

type Input = {
  schoolId: string
  yearId?: string
  kind: 'teachers' | 'administration' | 'students'
  staff?: StaffIn[]
  students?: StudentIn[]
}

export type RowResult = {
  line: number
  status: 'created' | 'linked' | 'exists' | 'error'
  notes: string[]
}
export type Credential = { name: string; email: string; password: string; role: string }
export type ImportResult = { results: RowResult[]; credentials: Credential[] }

const MAX_ROWS = 2000

function tempPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `Ecole-${s}`
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim()

export const importMembers = createServerFn({ method: 'POST' })
  .validator((d: Input) => {
    if (!d?.schoolId || !['teachers', 'administration', 'students'].includes(d.kind)) throw new Error('Import invalide')
    const n = (d.staff?.length ?? 0) + (d.students?.length ?? 0)
    if (n === 0) throw new Error('Aucune ligne à importer')
    if (n > MAX_ROWS) throw new Error(`Au plus ${MAX_ROWS} lignes par import`)
    return d
  })
  .handler(async ({ data }): Promise<ImportResult> => {
    const db = createClient()
    const { data: claims } = await db.auth.getClaims()
    if (!claims?.claims) throw new Error('Non authentifié')
    const { data: me } = await db.from('users').select('id').eq('auth_provider_id', claims.claims.sub).single()
    const { data: mine } = await db
      .from('school_members')
      .select('role')
      .eq('school_id', data.schoolId)
      .eq('user_id', me?.id ?? '')
      .eq('status', 'active')
    const roles = (mine ?? []).map((m) => m.role)
    const isAdmin = roles.includes('admin')
    const isOffice = isAdmin || roles.includes('staff')
    if (data.kind === 'students' ? !isOffice : !isAdmin) throw new Error('Droits insuffisants pour cet import')

    const admin = createServiceClient()
    const credentials: Credential[] = []
    const results: RowResult[] = []

    // Login or contact record for a person: reuse by e-mail (or phone),
    // otherwise create. Without an e-mail a parent gets a record without login
    // (reachable by phone / WhatsApp), which is the schema's "invited" user.
    async function ensureUser(p: { fullName: string; email: string; phone: string }, roleLabel: string) {
      if (p.email) {
        const { data: found } = await admin
          .from('users')
          .select('id, auth_provider_id')
          .ilike('email', p.email.replace(/[%_\\]/g, '\\$&'))
          .maybeSingle()
        if (found?.auth_provider_id) return { userId: found.id as string, isNew: false }
        const password = tempPassword()
        const { error } = await admin.auth.admin.createUser({
          email: p.email,
          password,
          email_confirm: true,
          user_metadata: { full_name: p.fullName },
        })
        if (error) throw new Error(error.message)
        const { data: created } = await admin.from('users').select('id').ilike('email', p.email.replace(/[%_\\]/g, '\\$&')).single()
        if (p.phone) await admin.from('users').update({ phone: p.phone }).eq('id', created!.id).is('phone', null)
        credentials.push({ name: p.fullName, email: p.email, password, role: roleLabel })
        return { userId: created!.id as string, isNew: !found }
      }
      const { data: byPhone } = await admin.from('users').select('id').eq('phone', p.phone).maybeSingle()
      if (byPhone) return { userId: byPhone.id as string, isNew: false }
      const { data: inserted, error } = await admin
        .from('users')
        .insert({ full_name: p.fullName, phone: p.phone, status: 'invited' })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return { userId: inserted.id as string, isNew: true }
    }

    async function ensureMember(userId: string, role: string) {
      const { data: existing } = await admin
        .from('school_members')
        .select('id, status')
        .eq('school_id', data.schoolId)
        .eq('user_id', userId)
        .eq('role', role)
        .maybeSingle()
      if (existing) {
        if (existing.status !== 'active') await admin.from('school_members').update({ status: 'active' }).eq('id', existing.id)
        return { memberId: existing.id as string, existed: true }
      }
      const { data: m, error } = await admin
        .from('school_members')
        .insert({ school_id: data.schoolId, user_id: userId, role })
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      return { memberId: m.id as string, existed: false }
    }

    // ------------------------------------------------------------ staff
    if (data.kind !== 'students') {
      for (const r of data.staff ?? []) {
        try {
          if (!r.fullName || !r.email) throw new Error('nom et e-mail obligatoires')
          const role = data.kind === 'teachers' ? 'teacher' : r.role === 'admin' ? 'admin' : 'staff'
          const u = await ensureUser(r, role)
          const m = await ensureMember(u.userId, role)
          results.push({
            line: r.line,
            status: m.existed ? 'exists' : u.isNew ? 'created' : 'linked',
            notes: m.existed ? ['alreadyMember'] : u.isNew ? [] : ['existingAccount'],
          })
        } catch (e) {
          results.push({ line: r.line, status: 'error', notes: [(e as Error).message] })
        }
      }
      return { results, credentials }
    }

    // ------------------------------------------------------------ students
    const { data: year } = await db
      .from('academic_years')
      .select('id, starts_on')
      .eq('id', data.yearId ?? '')
      .eq('school_id', data.schoolId)
      .maybeSingle()
    if (!year) throw new Error('Année scolaire introuvable')

    const { data: classRows } = await db.from('classes').select('id, name').eq('academic_year_id', year.id)
    const classes = new Map((classRows ?? []).map((c) => [norm(c.name), c.id as string]))
    const { data: nodes } = await db.from('curriculum_nodes').select('id, name, name_ar, code, parent_id').eq('school_id', data.schoolId)
    const parentIds = new Set((nodes ?? []).map((n) => n.parent_id).filter(Boolean))
    const leaves = new Map<string, string>()
    for (const n of nodes ?? [])
      if (!parentIds.has(n.id)) for (const k of [n.name, n.name_ar, n.code]) if (k) leaves.set(norm(k), n.id)

    const { data: existing } = await db
      .from('students')
      .select('first_name, last_name, birth_date, external_refs')
      .eq('school_id', data.schoolId)
    const massars = new Set((existing ?? []).map((s) => (s.external_refs as { massar_code?: string })?.massar_code).filter(Boolean))
    const identities = new Set((existing ?? []).map((s) => `${norm(s.first_name)}|${norm(s.last_name)}|${s.birth_date ?? ''}`))

    for (const r of data.students ?? []) {
      const notes: string[] = []
      try {
        if (!r.firstName || !r.lastName) throw new Error('prénom et nom obligatoires')
        const identity = `${norm(r.firstName)}|${norm(r.lastName)}|${r.birthDate ?? ''}`
        if ((r.massar && massars.has(r.massar)) || identities.has(identity)) {
          results.push({ line: r.line, status: 'exists', notes: ['alreadyStudent'] })
          continue
        }

        // Class of the year: by name; created under its level when missing.
        let classId: string | null = null
        if (r.className) {
          classId = classes.get(norm(r.className)) ?? null
          if (!classId) {
            const nodeId = leaves.get(norm(r.level))
            if (!nodeId) throw new Error(`classe « ${r.className} » inconnue et niveau « ${r.level || '—'} » non reconnu`)
            if (!isAdmin) throw new Error(`classe « ${r.className} » inconnue (seule l’administration peut la créer)`)
            const { data: c, error } = await db
              .from('classes')
              .insert({ school_id: data.schoolId, academic_year_id: year.id, node_id: nodeId, name: r.className, capacity: 28 })
              .select('id')
              .single()
            if (error) throw new Error(error.message)
            classId = c.id
            classes.set(norm(r.className), c.id)
            notes.push('classCreated')
          }
        }

        const { data: s, error } = await db
          .from('students')
          .insert({
            school_id: data.schoolId,
            first_name: r.firstName,
            last_name: r.lastName,
            birth_date: r.birthDate,
            gender: r.gender,
            external_refs: r.massar ? { massar_code: r.massar } : {},
          })
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        massars.add(r.massar)
        identities.add(identity)

        if (classId) {
          const { error: e } = await db.from('enrollments').insert({
            school_id: data.schoolId,
            student_id: s.id,
            class_id: classId,
            academic_year_id: year.id,
            started_on: year.starts_on,
          })
          if (e) throw new Error(e.message)
        } else notes.push('noClass')

        for (const [i, p] of r.parents.entries()) {
          if (!p.fullName || (!p.email && !p.phone)) continue
          const u = await ensureUser(p, 'parent')
          const m = await ensureMember(u.userId, 'parent')
          const { error: e } = await db.from('student_guardians').insert({
            school_id: data.schoolId,
            student_id: s.id,
            guardian_member_id: m.memberId,
            relationship: p.relationship,
            is_primary: i === 0,
            is_payer: i === 0,
          })
          if (e && e.code !== '23505') throw new Error(e.message)
          notes.push(m.existed ? 'parentLinked' : p.email ? 'parentCreated' : 'parentNoLogin')
        }
        results.push({ line: r.line, status: 'created', notes })
      } catch (e) {
        results.push({ line: r.line, status: 'error', notes: [(e as Error).message] })
      }
    }
    return { results, credentials }
  })
