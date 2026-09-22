#!/usr/bin/env node
// Seeds a complete préscolaire school: "Jardin d'Enfants Al Amal" (spec 01).
//  - admin: directeur@laureats.test (existing account) — the school appears in
//    his school switcher
//  - PS / MS / GS, one class per level, home rooms + a motricité room
//  - the full préscolaire programme (6 activities, 20 h/week), confirmed
//  - 5 teachers (3 class teachers, Arabic, motricité/arts) + assignments
//  - 50 children with birth dates, 44 parent accounts (6 sibling pairs)
//  - a conflict-free weekly timetable per class, published
// Everything except account creation runs as the admin, through RLS.
// Usage: node scripts/seed_preschool.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const service = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data
}

// Deterministic pseudo-random (same data on every run)
let seed = 42
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pick = (a) => a[Math.floor(rand() * a.length)]

const ADMIN_EMAIL = 'directeur@laureats.test'
const PASSWORD = 'password123'
const SLUG = 'jardin-al-amal'

const admin = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
must(await admin.auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD }), 'admin sign in')

if ((await service.from('schools').select('id').eq('slug', SLUG).maybeSingle()).data) {
  console.log(`L'école ${SLUG} existe déjà — rien à faire.`)
  process.exit(0)
}

// ---------------------------------------------------------------- school
const opening = { days: ['1', '2', '3', '4', '5'], day: ['08:30', '16:30'], lunch: ['12:30', '14:00'], recess: ['10:15', '10:30'] }
const schoolId = must(
  await admin.rpc('create_school', {
    p_name: "Jardin d'Enfants Al Amal",
    p_slug: SLUG,
    p_settings: { city: 'Casablanca', address: '24, rue Al Massira — Oasis', levels_offered: ['PRESCO'], opening, requires_massar_sync: false },
  }),
  'create_school',
)
must(await admin.rpc('instantiate_curriculum_cycles', { p_school_id: schoolId, p_template_code: 'ma_public', p_cycle_codes: ['PRESCO'] }), 'tree')
const year = must(
  await admin.from('academic_years').insert({ school_id: schoolId, name: '2026-2027', starts_on: '2026-09-07', ends_on: '2027-06-30' }).select('id').single(),
  'year',
)
must(await admin.rpc('set_current_academic_year', { p_year_id: year.id }), 'current year')
must(await admin.rpc('apply_curriculum_template_hours', { p_school_id: schoolId, p_academic_year_id: year.id, p_template_code: 'ma_public' }), 'hours')
must(await admin.from('node_subject_hours').update({ status: 'confirmed' }).eq('academic_year_id', year.id), 'confirm hours')
console.log('✓ école, année 2026-2027, programme préscolaire (horaires confirmés)')

// ---------------------------------------------------------------- rooms & classes
const levels = must(await admin.from('curriculum_nodes').select('id, code').eq('school_id', schoolId).eq('kind', 'level'), 'levels')
const node = Object.fromEntries(levels.map((l) => [l.code, l.id]))
const rooms = must(
  await admin
    .from('rooms')
    .insert([
      { school_id: schoolId, name: 'Les Coccinelles', capacity: 20 },
      { school_id: schoolId, name: 'Les Papillons', capacity: 20 },
      { school_id: schoolId, name: 'Les Hirondelles', capacity: 20 },
      { school_id: schoolId, name: 'Salle de motricité', capacity: 25 },
    ])
    .select('id, name'),
  'rooms',
)
const room = Object.fromEntries(rooms.map((r) => [r.name, r.id]))
const subjects = must(await admin.from('subjects').select('id, code, name').eq('school_id', schoolId), 'subjects')
const subj = Object.fromEntries(subjects.map((s) => [s.code, s]))
must(await admin.from('subjects').update({ room_id: room['Salle de motricité'] }).eq('id', subj.EPS.id), 'EPS room')

const classDefs = [
  { code: 'PRESCO_PS', name: 'Petite section A', room: 'Les Coccinelles', size: 16, born: 2023 },
  { code: 'PRESCO_MS', name: 'Moyenne section A', room: 'Les Papillons', size: 17, born: 2022 },
  { code: 'PRESCO_GS', name: 'Grande section A', room: 'Les Hirondelles', size: 17, born: 2021 },
]
const classes = must(
  await admin
    .from('classes')
    .insert(classDefs.map((c) => ({ school_id: schoolId, academic_year_id: year.id, node_id: node[c.code], name: c.name, capacity: 20, home_room_id: room[c.room] })))
    .select('id, name'),
  'classes',
)
classDefs.forEach((c, i) => (c.id = classes.find((x) => x.name === c.name).id))
console.log('✓ 3 classes (PS, MS, GS) avec leur salle + salle de motricité')

// ---------------------------------------------------------------- accounts
async function account(email, fullName, role) {
  // Reuse the login if it already exists (re-runs after a partial seed)
  const existing = await service.from('users').select('id').eq('email', email).maybeSingle()
  if (!existing.data)
    must(await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } }), `user ${email}`)
  const u = must(await service.from('users').select('id').eq('email', email).single(), 'user row')
  return must(await service.from('school_members').insert({ school_id: schoolId, user_id: u.id, role }).select('id').single(), 'member').id
}

const teacherDefs = [
  { key: 'PS', name: 'Salma Idrissi', email: 'salma.idrissi@alamal.test' },
  { key: 'MS', name: 'Houda Bennani', email: 'houda.bennani@alamal.test' },
  { key: 'GS', name: 'Nora El Fassi', email: 'nora.elfassi@alamal.test' },
  { key: 'AR', name: 'Khadija Amrani', email: 'khadija.amrani@alamal.test' },
  { key: 'SP', name: 'Youssef Tazi', email: 'youssef.tazi@alamal.test' },
]
const T = {}
for (const t of teacherDefs) T[t.key] = await account(t.email, t.name, 'teacher')
console.log('✓ 5 professeurs (3 maîtresses de classe, arabe, motricité/arts)')

// Who teaches what: the class teacher does French, logico-maths and éveil;
// Khadija the Arabic language in all three classes; Youssef motricité + arts.
const owner = (cls, code) => (code === 'LANG_AR' ? T.AR : code === 'EPS' || code === 'ARTS' ? T.SP : T[cls.code.split('_')[1]])
const assignments = []
for (const c of classDefs)
  for (const code of ['LANG_AR', 'LANG_FR', 'LOGMATH', 'EVEIL', 'ARTS', 'EPS'])
    assignments.push({ school_id: schoolId, class_id: c.id, subject_id: subj[code].id, teacher_member_id: owner(c, code) })
must(await admin.from('teaching_assignments').insert(assignments), 'assignments')

// ---------------------------------------------------------------- children & parents
const GIRLS = ['Yasmine', 'Lina', 'Salma', 'Aya', 'Nour', 'Rim', 'Inès', 'Malak', 'Hiba', 'Sara', 'Ghita', 'Imane', 'Rania', 'Kenza', 'Douae', 'Hajar', 'Wiam', 'Chaïma', 'Zineb', 'Assia']
const BOYS = ['Adam', 'Rayan', 'Youssef', 'Omar', 'Amine', 'Ilyas', 'Anas', 'Hamza', 'Mehdi', 'Ayoub', 'Zakaria', 'Yassine', 'Saad', 'Taha', 'Ismaïl', 'Nabil', 'Karim', 'Mohamed', 'Ali', 'Badr']
const FAMILIES = ['Alaoui', 'Bennani', 'Berrada', 'Chraibi', 'El Amrani', 'El Idrissi', 'Fassi', 'Guessous', 'Hajji', 'Jabri', 'Kettani', 'Lahlou', 'Mansouri', 'Naciri', 'Ouazzani', 'Rahmouni', 'Sebti', 'Tahiri', 'Zniber', 'Benjelloun', 'Cherkaoui', 'Daoudi', 'El Khatib', 'Filali', 'Ghazi', 'Haddad', 'Iraqi', 'Kabbaj', 'Laraki', 'Mernissi', 'Nejjar', 'Qadiri', 'Rami', 'Saïdi', 'Tazi', 'Wahbi', 'Yacoubi', 'Zerhouni', 'Benkirane', 'Bouzidi', 'El Ouali', 'Hakimi', 'Sqalli', 'Belghiti']
const MOTHERS = ['Fatima', 'Khadija', 'Naima', 'Samira', 'Latifa', 'Meryem', 'Asmae', 'Loubna', 'Sanaa', 'Hanane', 'Karima', 'Btissam']
const FATHERS = ['Karim', 'Hicham', 'Rachid', 'Mustapha', 'Abdelilah', 'Said', 'Nabil', 'Tarik', 'Jamal', 'Driss', 'Khalid', 'Hassan']

// 44 families: the first 6 have two children (siblings across levels)
const children = [] // { first, last, gender, birth, classIdx, family }
let f = 0
const counts = [0, 0, 0]
const plan = [] // family -> list of class indexes
for (let i = 0; i < 6; i++) plan.push([i % 3, (i + 1) % 3])
while (plan.flat().length < 50) plan.push([plan.length % 3])
for (const fam of plan) {
  const last = FAMILIES[f]
  for (const ci of fam) {
    const girl = rand() < 0.5
    const born = classDefs[ci].born
    const m = 1 + Math.floor(rand() * 12)
    const d = 1 + Math.floor(rand() * 28)
    children.push({ first: girl ? pick(GIRLS) : pick(BOYS), last, gender: girl ? 'female' : 'male', birth: `${born}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, classIdx: ci, family: f })
    counts[ci]++
  }
  f++
}
// rebalance to exactly 16/17/17
const target = classDefs.map((c) => c.size)
for (const ch of children.filter((c) => plan[c.family].length === 1)) {
  if (counts[ch.classIdx] > target[ch.classIdx]) {
    const to = counts.findIndex((n, i) => n < target[i])
    if (to >= 0) {
      counts[ch.classIdx]--
      counts[to]++
      ch.classIdx = to
      ch.birth = `${classDefs[to].born}${ch.birth.slice(4)}`
    }
  }
}

const inserted = must(
  await admin
    .from('students')
    .insert(children.map((c) => ({ school_id: schoolId, first_name: c.first, last_name: c.last, gender: c.gender, birth_date: c.birth })))
    .select('id'),
  'students',
)
children.forEach((c, i) => (c.id = inserted[i].id))
must(
  await admin.from('enrollments').insert(
    children.map((c) => ({ school_id: schoolId, student_id: c.id, class_id: classDefs[c.classIdx].id, academic_year_id: year.id, started_on: '2026-09-07' })),
  ),
  'enrollments',
)

const guardians = []
for (let fi = 0; fi < plan.length; fi++) {
  const last = FAMILIES[fi]
  const mother = rand() < 0.75
  const first = mother ? pick(MOTHERS) : pick(FATHERS)
  const email = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z.]/g, '') + `.${fi}@parents-alamal.test`
  const memberId = await account(email, `${first} ${last}`, 'parent')
  for (const c of children.filter((x) => x.family === fi))
    guardians.push({ school_id: schoolId, student_id: c.id, guardian_member_id: memberId, relationship: mother ? 'mother' : 'father', is_primary: true, is_payer: true })
}
must(await admin.from('student_guardians').insert(guardians), 'guardians')
console.log(`✓ 50 enfants (PS ${counts[0]}, MS ${counts[1]}, GS ${counts[2]}), ${plan.length} familles dont 6 fratries`)

// ---------------------------------------------------------------- timetables
// Greedy, conflict-free: heavy language sessions in the morning, motricité
// and arts in the afternoon, at most one session of a subject per day, the
// two shared teachers never in two classes at once.
const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5)
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const PERIODS = [
  [toMin('08:30'), toMin('10:15')],
  [toMin('10:30'), toMin('12:30')],
  [toMin('14:00'), toMin('16:30')],
]
// Shared teachers' subjects first (Youssef, Khadija), across all classes,
// then each class teacher's own subjects fill the remaining time.
const SESSIONS = [
  ['ARTS', 60, 3, 'pm-first'],
  ['EPS', 60, 2, 'pm-first'],
  ['LANG_AR', 60, 5, 'any'],
  ['LANG_FR', 60, 5, 'any'],
  ['LOGMATH', 45, 4, 'any'],
  ['EVEIL', 60, 2, 'any'],
]
const busy = {} // teacher -> day -> [[s,e]]
const isFree = (tId, day, s, e) => !(busy[tId]?.[day] ?? []).some(([a, b]) => a < e && s < b)
const reserve = (tId, day, s, e) => ((busy[tId] ??= {})[day] ??= []).push([s, e])
const classBusy = classDefs.map(() => ({}))
const classSlots = classDefs.map(() => [])

for (const [code, len, count, when] of SESSIONS) {
  for (let ci = 0; ci < classDefs.length; ci++) {
    const c = classDefs[ci]
    const tId = owner(c, code)
    let placed = 0
    // rotate the starting day per class so shared teachers spread out
    for (let k = 0; k < 5 && placed < count; k++) {
      const day = ((k + ci * 2) % 5) + 1
      const periods = when === 'am' ? PERIODS.slice(0, 2) : when === 'pm-first' ? [PERIODS[2], PERIODS[1], PERIODS[0]] : PERIODS
      let done = false
      for (const [ps, pe] of periods) {
        for (let s = ps; s + len <= pe && !done; s += 15) {
          const e = s + len
          const clash = (classBusy[ci][day] ?? []).some(([a, b]) => a < e && s < b)
          if (!clash && isFree(tId, day, s, e)) {
            ;(classBusy[ci][day] ??= []).push([s, e])
            reserve(tId, day, s, e)
            classSlots[ci].push({ weekday: day, starts_at: hhmm(s), ends_at: hhmm(e), subject_id: subj[code].id, teacher_member_id: tId })
            placed++
            done = true
          }
        }
        if (done) break
      }
    }
    if (placed < count) throw new Error(`${c.name}: seulement ${placed}/${count} séances de ${code}`)
  }
}

for (let ci = 0; ci < classDefs.length; ci++) {
  const c = classDefs[ci]
  const slots = classSlots[ci]
  const v = must(
    await admin.from('timetable_versions').insert({ school_id: schoolId, class_id: c.id, name: 'Rentrée 2026-2027', effective_from: '2026-09-07' }).select('id').single(),
    'version',
  )
  must(
    await admin.from('timetable_slots').insert(slots.map((s) => ({ ...s, school_id: schoolId, class_id: c.id, version_id: v.id }))),
    `slots ${c.name}`,
  )
  must(await admin.rpc('publish_timetable_version', { p_version_id: v.id }), 'publish')
  const minutes = slots.reduce((a, s) => a + toMin(s.ends_at) - toMin(s.starts_at), 0)
  console.log(`✓ ${c.name} : ${slots.length} séances, ${minutes / 60} h/semaine, publié`)
}

// ---------------------------------------------------------------- check
const req = must(await admin.from('class_required_hours').select('class_id, weekly_minutes').in('class_id', classDefs.map((c) => c.id)), 'required')
const got = must(await admin.from('timetable_slots').select('class_id, starts_at, ends_at').eq('school_id', schoolId), 'placed')
for (const c of classDefs) {
  const need = req.filter((r) => r.class_id === c.id).reduce((a, r) => a + r.weekly_minutes, 0)
  const have = got.filter((s) => s.class_id === c.id).reduce((a, s) => a + toMin(s.ends_at) - toMin(s.starts_at), 0)
  console.log(`  ${c.name}: ${have / 60} h placées / ${need / 60} h requises ${have === need ? '✓' : '✗'}`)
}
console.log(`\nConnexion admin : ${ADMIN_EMAIL} → menu du compte → « Jardin d'Enfants Al Amal ».`)
console.log(`Professeurs : ${teacherDefs.map((t) => t.email).join(', ')} — mot de passe ${PASSWORD}`)
