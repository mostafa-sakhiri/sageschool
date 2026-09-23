#!/usr/bin/env node
// Seeds a small, self-contained demo maternelle for client presentations:
// "Ptichou Preschool (démo)", after the real 2026-2027 petite section timetable
// (Emploi_du_temps_Petite_Section_Ptichou.pdf).
//  - its own admin account (the directrice) — nothing shared with other schools
//  - the préscolaire day as the cycle's horaire; Friday ends at 12:30
//  - one class, Petite section, in its home room + the motor skills room
//  - the préscolaire activities (14 activities, 16 h/week), confirmed
//  - 2 teachers (class teacher + English teacher) and a classroom assistant
//  - 10 children born in 2023, one of them with a parent account
//  - the PDF timetable, slot for slot, published
// Everything except account creation runs as the directrice, through RLS.
// Usage: node scripts/seed_demo_maternelle.mjs
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

const PASSWORD = 'password123'
const SLUG = 'ptichou-demo'
const DOMAIN = 'ptichou-demo.test'
const ADMIN = { email: `directrice@${DOMAIN}`, name: 'Leila Benchekroun' }

if ((await service.from('schools').select('id').eq('slug', SLUG).maybeSingle()).data) {
  console.log(`L'école ${SLUG} existe déjà — rien à faire.`)
  process.exit(0)
}

// Reuse the login if it already exists (re-runs after a partial seed)
async function user(email, fullName) {
  const existing = await service.from('users').select('id').eq('email', email).maybeSingle()
  if (!existing.data)
    must(await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } }), `user ${email}`)
  return must(await service.from('users').select('id').eq('email', email).single(), 'user row').id
}

await user(ADMIN.email, ADMIN.name)
const admin = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
must(await admin.auth.signInWithPassword({ email: ADMIN.email, password: PASSWORD }), 'admin sign in')

// ---------------------------------------------------------------- school
// The PDF's day, labels included
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
    p_name: 'Ptichou Preschool (démo)',
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
console.log('✓ école, horaire du préscolaire, année 2026-2027, activités confirmées')

// ---------------------------------------------------------------- room & class
const ps = must(await admin.from('curriculum_nodes').select('id').eq('school_id', schoolId).eq('code', 'PRESCO_PS').single(), 'PS node')
const rooms = must(
  await admin
    .from('rooms')
    .insert([
      { school_id: schoolId, name: 'Les Coccinelles', capacity: 15 },
      { school_id: schoolId, name: 'Salle de motricité', capacity: 20 },
    ])
    .select('id, name'),
  'rooms',
)
const cls = must(
  await admin
    .from('classes')
    .insert({ school_id: schoolId, academic_year_id: year.id, node_id: ps.id, name: 'Petite section', capacity: 15, home_room_id: rooms.find((r) => r.name === 'Les Coccinelles').id })
    .select('id')
    .single(),
  'class',
)
const subjects = must(await admin.from('subjects').select('id, code').eq('school_id', schoolId), 'subjects')
const subj = Object.fromEntries(subjects.map((s) => [s.code, s]))
console.log('✓ classe Petite section (Les Coccinelles) + salle de motricité')

// ---------------------------------------------------------------- staff
async function member(email, fullName, role) {
  const id = await user(email, fullName)
  return must(await service.from('school_members').insert({ school_id: schoolId, user_id: id, role }).select('id').single(), 'member').id
}
const people = {
  maitresse: { name: 'Salma Idrissi', email: `salma.idrissi@${DOMAIN}` },
  anglais: { name: 'Sarah Lahlou', email: `sarah.lahlou@${DOMAIN}` },
  assistante: { name: 'Khadija Amrani', email: `khadija.amrani@${DOMAIN}` },
}
const T = {}
for (const [k, p] of Object.entries(people)) T[k] = await member(p.email, p.name, 'teacher')

// The class teacher leads every activity except English; the assistant helps
// in the class all day (no subject)
const owner = (code) => (code === 'ANG_EVEIL' ? T.anglais : T.maitresse)
must(
  await admin.from('teaching_assignments').insert([
    ...subjects.map((s) => ({ school_id: schoolId, class_id: cls.id, subject_id: s.id, teacher_member_id: owner(s.code), kind: s.code === 'ANG_EVEIL' ? 'specialist' : 'main' })),
    { school_id: schoolId, class_id: cls.id, subject_id: null, teacher_member_id: T.assistante, kind: 'assistant' },
  ]),
  'assignments',
)
console.log('✓ 2 professeures (maîtresse + anglais) et une assistante de classe')

// ---------------------------------------------------------------- children & parent
const CHILDREN = [
  ['Adam', 'Alaoui', 'male', '2023-02-14'],
  ['Yasmine', 'Bennani', 'female', '2023-03-22'],
  ['Rayan', 'Berrada', 'male', '2023-01-09'],
  ['Lina', 'Chraibi', 'female', '2023-05-30'],
  ['Youssef', 'El Amrani', 'male', '2023-07-18'],
  ['Aya', 'Fassi', 'female', '2023-04-03'],
  ['Omar', 'Guessous', 'male', '2023-09-11'],
  ['Nour', 'Kettani', 'female', '2023-06-25'],
  ['Ilyas', 'Mansouri', 'male', '2023-10-07'],
  ['Inès', 'Tazi', 'female', '2023-08-16'],
]
const students = must(
  await admin
    .from('students')
    .insert(CHILDREN.map(([first_name, last_name, gender, birth_date]) => ({ school_id: schoolId, first_name, last_name, gender, birth_date })))
    .select('id, first_name'),
  'students',
)
must(
  await admin.from('enrollments').insert(students.map((s) => ({ school_id: schoolId, student_id: s.id, class_id: cls.id, academic_year_id: year.id, started_on: '2026-09-07' }))),
  'enrollments',
)
const parent = { name: 'Meryem Bennani', email: `meryem.bennani@${DOMAIN}` }
const parentId = await member(parent.email, parent.name, 'parent')
must(
  await admin.from('student_guardians').insert({
    school_id: schoolId,
    student_id: students.find((s) => s.first_name === 'Yasmine').id,
    guardian_member_id: parentId,
    relationship: 'mother',
    is_primary: true,
    is_payer: true,
  }),
  'guardian',
)
console.log('✓ 10 enfants inscrits, 1 parent (mère de Yasmine Bennani)')

// ---------------------------------------------------------------- timetable
// The PDF, activities only: the routines are the horaire's pauses. [code, minutes, title]
const WEEK = {
  1: {
    am: [['GRAPHISME', 45, 'Activité de livre • Graphisme'], ['RITUEL', 30], ['MOTRICITE', 30, 'Jeux de motricité'], ['MODELAGE', 15]],
    pm: [['CLASSEUR', 30, 'Activités de classeur (divers)'], ['ARTS_PLAST', 30, 'Activité artistique • Coloriage'], ['DESSIN_FR', 30]],
  },
  2: {
    am: [['ORG_PENSEE', 45, "Activité d'organisation de la pensée"], ['RITUEL', 30], ['MOTRICITE', 30, 'Jeux de motricité'], ['MODELAGE', 15]],
    pm: [['ORG_PENSEE', 30, 'Activité classeur • Organisation de la pensée'], ['ANG_EVEIL', 60, 'Anglais']],
  },
  3: {
    am: [['DECOUVERTE', 45, 'Activité de découverte du monde'], ['RITUEL', 30], ['MOTRICITE', 30, 'Parcours moteur • courir, sauter'], ['MODELAGE', 15]],
    pm: [['LANGAGE', 30, 'Langage • histoire séquentielle, marionnettes'], ['DECOUVERTE', 30, 'Activité libre • Découverte du monde'], ['ARTS_PLAST', 30, 'Peinture • Pâte à modeler']],
  },
  4: {
    am: [['ACT_LIBRE', 45], ['RITUEL', 30], ['MOTRICITE', 30, 'Yoga'], ['MODELAGE', 15]],
    pm: [['THEATRE', 30], ['ACT_DIRIGEE', 30], ['ANG_EVEIL', 30, 'Dessin éducatif • vocabulaire en anglais']],
  },
  5: {
    am: [['ACT_LIBRE', 45, 'Activité libre (selon une consigne)'], ['RITUEL', 30], ['MOTRICITE', 30, 'Activité de motricité fine'], ['LANGAGE', 15, 'Conte en français ou en anglais']],
  },
}
const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5)
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const lay = (weekday, from, blocks = []) => {
  let t = toMin(from)
  return blocks.map(([code, len, title]) => {
    const slot = { weekday, starts_at: hhmm(t), ends_at: hhmm(t + len), subject_id: subj[code].id, teacher_member_id: owner(code), title: title ?? null }
    t += len
    return slot
  })
}
const slots = Object.entries(WEEK).flatMap(([d, { am, pm }]) => [...lay(+d, '09:30', am), ...lay(+d, '14:30', pm)])
const v = must(
  await admin.from('timetable_versions').insert({ school_id: schoolId, class_id: cls.id, name: 'Rentrée 2026-2027', effective_from: '2026-09-07' }).select('id').single(),
  'version',
)
must(await admin.from('timetable_slots').insert(slots.map((s) => ({ ...s, school_id: schoolId, class_id: cls.id, version_id: v.id }))), 'slots')
must(await admin.rpc('publish_timetable_version', { p_version_id: v.id }), 'publish')
const minutes = slots.reduce((a, s) => a + toMin(s.ends_at) - toMin(s.starts_at), 0)
console.log(`✓ emploi du temps : ${slots.length} activités, ${minutes / 60} h/semaine, publié`)

// ---------------------------------------------------------------- check
const req = must(await admin.from('class_required_hours').select('subject_id, weekly_minutes').eq('class_id', cls.id), 'required')
const off = req.filter(
  (r) => slots.filter((s) => s.subject_id === r.subject_id).reduce((a, s) => a + toMin(s.ends_at) - toMin(s.starts_at), 0) !== r.weekly_minutes,
)
console.log(`  ${off.length ? `✗ ${off.length} activités mal couvertes` : 'programme couvert à la minute ✓'}`)

console.log(`\nComptes (mot de passe ${PASSWORD}) :`)
console.log(`  Directrice  ${ADMIN.email}`)
console.log(`  Maîtresse   ${people.maitresse.email}`)
console.log(`  Anglais     ${people.anglais.email}`)
console.log(`  Assistante  ${people.assistante.email}`)
console.log(`  Parent      ${parent.email}`)
