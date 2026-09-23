#!/usr/bin/env node
// Seeds a complete préscolaire: "Ptichou Preschool", after its real 2026-2027
// petite section timetable (Emploi_du_temps_Petite_Section_Ptichou.pdf).
//  - admin: directeur@laureats.test (existing account) — the school appears in
//    the admin's school switcher
//  - the préscolaire day as the cycle's horaire: accueil, goûter, déjeuner,
//    sieste, change + goûter, préparation à la sortie; Friday ends at 12:30;
//    one roll call a day
//  - PS / MS / GS, one class per level, each with its home room
//  - the préscolaire activities (14 activities, 16 h/week), confirmed
//  - 4 teachers (3 class teachers + an English teacher) + assignments
//  - 50 children with birth dates, 44 parent accounts (6 sibling pairs)
//  - PS: the PDF timetable, slot for slot; MS / GS: same mornings, afternoons
//    rotated so the English teacher is never in two classes at once. Published.
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
const SLUG = 'ptichou'

const admin = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
must(await admin.auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD }), 'admin sign in')

if ((await service.from('schools').select('id').eq('slug', SLUG).maybeSingle()).data) {
  console.log(`L'école ${SLUG} existe déjà — rien à faire.`)
  process.exit(0)
}

// ---------------------------------------------------------------- school
// The PDF's day, labels included (content: stays in French in the Arabic UI)
const day = (end, pauses) => ({ start: '08:30', end, pauses })
const horaire = {
  id: 'PRESCO',
  name: 'Préscolaire',
  cycles: ['PRESCO'],
  days: ['1', '2', '3', '4', '5'],
  rollCall: 'day',
  base: day('16:30', [
    { kind: 'welcome', label: 'Accueil des parents + jeux', start: '08:30', end: '09:00' },
    { kind: 'snack', label: 'Passage aux toilettes + goûter', start: '09:00', end: '09:30' },
    { kind: 'lunch', label: 'Passage aux toilettes + déjeuner', start: '11:30', end: '12:30' },
    { kind: 'nap', label: 'Sieste', start: '12:30', end: '14:00' },
    { kind: 'care', label: 'Changement + goûter', start: '14:00', end: '14:30' },
    { kind: 'dismissal', label: 'Préparation à la sortie (chanson + danse)', start: '16:00', end: '16:30' },
  ]),
  overrides: {
    5: day('12:30', [
      { kind: 'welcome', label: 'Accueil des parents + jeux', start: '08:30', end: '09:00' },
      { kind: 'snack', label: 'Passage aux toilettes + goûter', start: '09:00', end: '09:30' },
      { kind: 'dismissal', label: 'Préparation à la sortie', start: '11:30', end: '12:30' },
    ]),
  },
}
const schoolId = must(
  await admin.rpc('create_school', {
    p_name: 'Ptichou Preschool',
    p_slug: SLUG,
    p_settings: { city: 'Casablanca', address: '12, rue des Oliviers — Maârif', levels_offered: ['PRESCO'], schedules: [horaire], requires_massar_sync: false },
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
console.log('✓ école, horaire du préscolaire, année 2026-2027, 14 activités (16 h/semaine, confirmées)')

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

const classDefs = [
  { code: 'PRESCO_PS', name: 'Petite section', room: 'Les Coccinelles', size: 16, born: 2023 },
  { code: 'PRESCO_MS', name: 'Moyenne section', room: 'Les Papillons', size: 17, born: 2022 },
  { code: 'PRESCO_GS', name: 'Grande section', room: 'Les Hirondelles', size: 17, born: 2021 },
]
const classes = must(
  await admin
    .from('classes')
    .insert(classDefs.map((c) => ({ school_id: schoolId, academic_year_id: year.id, node_id: node[c.code], name: c.name, capacity: 20, home_room_id: room[c.room] })))
    .select('id, name'),
  'classes',
)
classDefs.forEach((c) => (c.id = classes.find((x) => x.name === c.name).id))
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
  { key: 'PS', name: 'Salma Idrissi', email: 'salma.idrissi@ptichou.test' },
  { key: 'MS', name: 'Houda Bennani', email: 'houda.bennani@ptichou.test' },
  { key: 'GS', name: 'Nora El Fassi', email: 'nora.elfassi@ptichou.test' },
  { key: 'EN', name: 'Sarah Lahlou', email: 'sarah.lahlou@ptichou.test' },
]
const T = {}
for (const t of teacherDefs) T[t.key] = await account(t.email, t.name, 'teacher')
console.log('✓ 4 professeurs (3 maîtresses de classe, une professeure d\'anglais)')

// The class teacher leads every activity, except English
const owner = (cls, code) => (code === 'ANG_EVEIL' ? T.EN : T[cls.code.split('_')[1]])
must(
  await admin.from('teaching_assignments').insert(
    classDefs.flatMap((c) =>
      subjects.map((s) => ({ school_id: schoolId, class_id: c.id, subject_id: s.id, teacher_member_id: owner(c, s.code) })),
    ),
  ),
  'assignments',
)

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
  const email = `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z.]/g, '') + `.${fi}@parents-ptichou.test`
  const memberId = await account(email, `${first} ${last}`, 'parent')
  for (const c of children.filter((x) => x.family === fi))
    guardians.push({ school_id: schoolId, student_id: c.id, guardian_member_id: memberId, relationship: mother ? 'mother' : 'father', is_primary: true, is_payer: true })
}
must(await admin.from('student_guardians').insert(guardians), 'guardians')
console.log(`✓ 50 enfants (PS ${counts[0]}, MS ${counts[1]}, GS ${counts[2]}), ${plan.length} familles dont 6 fratries`)

// ---------------------------------------------------------------- timetables
// Activities only: the routines are the horaire's pauses. [code, minutes, title]
const MORNING = {
  1: [['GRAPHISME', 45, 'Activité de livre • Graphisme'], ['RITUEL', 30], ['MOTRICITE', 30, 'Jeux de motricité'], ['MODELAGE', 15]],
  2: [['ORG_PENSEE', 45, "Activité d'organisation de la pensée"], ['RITUEL', 30], ['MOTRICITE', 30, 'Jeux de motricité'], ['MODELAGE', 15]],
  3: [['DECOUVERTE', 45, 'Activité de découverte du monde'], ['RITUEL', 30], ['MOTRICITE', 30, 'Parcours moteur • courir, sauter'], ['MODELAGE', 15]],
  4: [['ACT_LIBRE', 45], ['RITUEL', 30], ['MOTRICITE', 30, 'Yoga'], ['MODELAGE', 15]],
  5: [['ACT_LIBRE', 45, 'Activité libre (selon une consigne)'], ['RITUEL', 30], ['MOTRICITE', 30, 'Activité de motricité fine'], ['LANGAGE', 15, 'Conte en français ou en anglais']],
}
const AFTERNOON = {
  mon: [['CLASSEUR', 30, 'Activités de classeur (divers)'], ['ARTS_PLAST', 30, 'Activité artistique • Coloriage'], ['DESSIN_FR', 30]],
  tue: [['ORG_PENSEE', 30, 'Activité classeur • Organisation de la pensée'], ['ANG_EVEIL', 60, 'Anglais']],
  wed: [['LANGAGE', 30, 'Langage • histoire séquentielle, marionnettes'], ['DECOUVERTE', 30, 'Activité libre • Découverte du monde'], ['ARTS_PLAST', 30, 'Peinture • Pâte à modeler']],
  thu: [['THEATRE', 30], ['ACT_DIRIGEE', 30], ['ANG_EVEIL', 30, 'Dessin éducatif • vocabulaire en anglais']],
}
// Same afternoons, other days (and order): the English teacher is shared
const reorder = (blocks, first) => [blocks.find((b) => b[0] === first), ...blocks.filter((b) => b[0] !== first)]
const WEEK = {
  PRESCO_PS: { 1: AFTERNOON.mon, 2: AFTERNOON.tue, 3: AFTERNOON.wed, 4: AFTERNOON.thu },
  PRESCO_MS: { 1: AFTERNOON.tue, 2: AFTERNOON.wed, 3: AFTERNOON.thu, 4: AFTERNOON.mon },
  PRESCO_GS: { 1: AFTERNOON.wed, 2: reorder(AFTERNOON.thu, 'ANG_EVEIL'), 3: AFTERNOON.mon, 4: reorder(AFTERNOON.tue, 'ANG_EVEIL') },
}
const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5)
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const lay = (c, weekday, from, blocks) => {
  let t = toMin(from)
  return blocks.map(([code, len, title]) => {
    const slot = { weekday, starts_at: hhmm(t), ends_at: hhmm(t + len), subject_id: subj[code].id, teacher_member_id: owner(c, code), title: title ?? null }
    t += len
    return slot
  })
}

for (const c of classDefs) {
  const slots = []
  for (const d of [1, 2, 3, 4, 5]) {
    slots.push(...lay(c, d, '09:30', MORNING[d]))
    if (WEEK[c.code][d]) slots.push(...lay(c, d, '14:30', WEEK[c.code][d]))
  }
  const v = must(
    await admin.from('timetable_versions').insert({ school_id: schoolId, class_id: c.id, name: 'Rentrée 2026-2027', effective_from: '2026-09-07' }).select('id').single(),
    'version',
  )
  must(await admin.from('timetable_slots').insert(slots.map((s) => ({ ...s, school_id: schoolId, class_id: c.id, version_id: v.id }))), `slots ${c.name}`)
  must(await admin.rpc('publish_timetable_version', { p_version_id: v.id }), 'publish')
  const minutes = slots.reduce((a, s) => a + toMin(s.ends_at) - toMin(s.starts_at), 0)
  console.log(`✓ ${c.name} : ${slots.length} activités, ${minutes / 60} h/semaine, publié`)
}

// ---------------------------------------------------------------- check
const req = must(await admin.from('class_required_hours').select('class_id, subject_id, weekly_minutes').in('class_id', classDefs.map((c) => c.id)), 'required')
const got = must(await admin.from('timetable_slots').select('class_id, subject_id, starts_at, ends_at').eq('school_id', schoolId), 'placed')
for (const c of classDefs) {
  const off = req
    .filter((r) => r.class_id === c.id)
    .filter((r) => got.filter((s) => s.class_id === c.id && s.subject_id === r.subject_id).reduce((a, s) => a + toMin(s.ends_at) - toMin(s.starts_at), 0) !== r.weekly_minutes)
  console.log(`  ${c.name}: ${off.length ? `✗ ${off.length} activités mal couvertes` : 'programme couvert à la minute ✓'}`)
}
console.log(`\nConnexion admin : ${ADMIN_EMAIL} → menu du compte → « Ptichou Preschool ».`)
console.log(`Professeurs : ${teacherDefs.map((t) => t.email).join(', ')} — mot de passe ${PASSWORD}`)
