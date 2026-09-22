#!/usr/bin/env node
// End-to-end walkthrough of the core loop on a FRESH school, as real users.
// Every step runs with the signed-in user's JWT through RLS (same calls as the
// UI), except account creation, which mirrors the `inviteMember` server
// function (secret key, after the caller's role was checked).
// Usage: node scripts/walkthrough.mjs  → prints a log and writes WALKTHROUGH.md
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const URL_ = env.VITE_SUPABASE_URL
const PK = env.VITE_SUPABASE_PUBLISHABLE_KEY
const admin = createClient(URL_, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

const run = Date.now().toString(36)
const log = []
let failures = 0
const step = (title) => log.push(`\n### ${title}\n`)
const ok = (msg) => log.push(`- ✅ ${msg}`)
const bad = (msg) => {
  failures++
  log.push(`- ❌ ${msg}`)
}
const check = (cond, msg, detail = '') => (cond ? ok(msg) : bad(`${msg}${detail ? ` — ${detail}` : ''}`))
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res.data
}

async function signIn(email, password) {
  const c = createClient(URL_, PK, { auth: { persistSession: false } })
  must(await c.auth.signInWithPassword({ email, password }), `sign in ${email}`)
  return c
}

// Mirrors inviteMember(): create the login (secret key) + membership.
async function invite(schoolId, email, fullName, role, studentId) {
  must(
    await admin.auth.admin.createUser({ email, password: 'password123', email_confirm: true, user_metadata: { full_name: fullName } }),
    `create ${email}`,
  )
  const user = must(await admin.from('users').select('id').eq('email', email).single(), 'user row')
  const member = must(
    await admin.from('school_members').insert({ school_id: schoolId, user_id: user.id, role }).select('id').single(),
    'membership',
  )
  if (studentId) must(await admin.from('students').update({ member_id: member.id }).eq('id', studentId), 'link student')
  return member.id
}

try {
  const email = (who) => `${who}.${run}@walkthrough.test`

  // ------------------------------------------------------------------
  step('0. Le fondateur crée son compte')
  const anon = createClient(URL_, PK, { auth: { persistSession: false } })
  must(
    await anon.auth.signUp({ email: email('directeur'), password: 'password123', options: { data: { full_name: 'Driss Walk' } } }),
    'signup',
  )
  const dir = await signIn(email('directeur'), 'password123')
  ok(`compte ${email('directeur')} créé et connecté (Supabase Auth, profil public.users lié par trigger)`)

  // ------------------------------------------------------------------
  step('1. École → année scolaire → arbre du programme')
  const schoolId = must(
    await dir.rpc('create_school', {
      p_name: `École Walkthrough ${run}`,
      p_slug: `walk-${run}`,
      p_settings: { city: 'Rabat', levels_offered: ['PRESCO', 'PRIM'], opening: { days: ['1', '2', '3', '4', '5'], day: ['08:30', '16:30'], lunch: ['12:30', '14:00'], recess: ['10:15', '10:30'] } },
    }),
    'create_school',
  )
  ok(`école créée (${schoolId}) — le créateur est admin`)
  const nodes = must(
    await dir.rpc('instantiate_curriculum_cycles', { p_school_id: schoolId, p_template_code: 'ma_public', p_cycle_codes: ['PRESCO', 'PRIM'] }),
    'instantiate',
  )
  check(nodes === 11, `arbre instancié : ${nodes} nœuds (Préscolaire 3 + Primaire 6 + 2 cycles)`)
  const year = must(
    await dir.from('academic_years').insert({ school_id: schoolId, name: '2026-2027', starts_on: '2026-09-07', ends_on: '2027-06-30' }).select('id').single(),
    'year',
  )
  must(await dir.rpc('set_current_academic_year', { p_year_id: year.id }), 'set current')
  const hours = must(
    await dir.rpc('apply_curriculum_template_hours', { p_school_id: schoolId, p_academic_year_id: year.id, p_template_code: 'ma_public' }),
    'apply hours',
  )
  check(hours > 0, `année 2026-2027 en cours ; ${hours} lignes d'horaires par défaut appliquées (statut « proposé »)`)
  const confirmed = must(
    await dir.from('node_subject_hours').update({ status: 'confirmed' }).eq('academic_year_id', year.id).neq('status', 'confirmed').select('id'),
    'confirm',
  )
  ok(`${confirmed.length} horaires confirmés par l'école`)

  // ------------------------------------------------------------------
  step("2. L'équipe : professeurs et secrétariat")
  const t1 = await invite(schoolId, email('prof1'), 'Nadia Walk', 'teacher')
  const t2 = await invite(schoolId, email('prof2'), 'Youssef Walk', 'teacher')
  const staff = await invite(schoolId, email('secretariat'), 'Samira Walk', 'staff')
  ok('2 professeurs + 1 secrétaire ajoutés avec leur rôle')

  // ------------------------------------------------------------------
  step('3. Classes sous les nœuds + horaires par défaut')
  const lvl = must(await dir.from('curriculum_nodes').select('id, code').eq('school_id', schoolId).in('code', ['PRIM_1', 'PRIM_2']), 'levels')
  const byCode = Object.fromEntries(lvl.map((n) => [n.code, n.id]))
  const room = must(await dir.from('rooms').insert({ school_id: schoolId, name: 'B12', capacity: 28 }).select('id').single(), 'room')
  const classes = must(
    await dir
      .from('classes')
      .insert([
        { school_id: schoolId, academic_year_id: year.id, node_id: byCode.PRIM_1, name: '1ère A', capacity: 28, home_room_id: room.id },
        { school_id: schoolId, academic_year_id: year.id, node_id: byCode.PRIM_2, name: '2ème A', capacity: 28 },
      ])
      .select('id, name'),
    'classes',
  )
  const [cA, cB] = classes
  const req = must(await dir.from('class_required_hours').select('subject_id, weekly_minutes').eq('class_id', cA.id), 'required hours')
  const total = req.reduce((s, r) => s + r.weekly_minutes, 0)
  check(req.length > 0, `1ère A hérite de ${req.length} matières, ${Math.round(total / 6) / 10} h/semaine (horaires du nœud « 1ère année primaire »)`)
  const subj = must(await dir.from('subjects').select('id, name').eq('school_id', schoolId), 'subjects')
  const math = subj.find((s) => s.name === 'Mathématiques')
  const arabe = subj.find((s) => s.name === 'Langue arabe')
  must(
    await dir.from('teaching_assignments').insert([
      { school_id: schoolId, class_id: cA.id, subject_id: math.id, teacher_member_id: t1 },
      { school_id: schoolId, class_id: cA.id, subject_id: arabe.id, teacher_member_id: t2 },
      { school_id: schoolId, class_id: cB.id, subject_id: math.id, teacher_member_id: t2 },
    ]),
    'assignments',
  )
  ok('attribution : Maths 1ère A → Nadia ; Arabe 1ère A et Maths 2ème A → Youssef')

  // ------------------------------------------------------------------
  step('4. Élèves + parents (fratrie)')
  const sec = await signIn(email('secretariat'), 'password123')
  const kids = must(
    await sec
      .from('students')
      .insert([
        { school_id: schoolId, first_name: 'Yasmine', last_name: 'Walk', gender: 'female' },
        { school_id: schoolId, first_name: 'Adam', last_name: 'Walk', gender: 'male' },
        { school_id: schoolId, first_name: 'Omar', last_name: 'Autre', gender: 'male' },
      ])
      .select('id, first_name'),
    'students',
  )
  const [yas, adam, omar] = kids
  must(
    await sec.from('enrollments').insert([
      { school_id: schoolId, student_id: yas.id, class_id: cA.id, academic_year_id: year.id },
      { school_id: schoolId, student_id: adam.id, class_id: cB.id, academic_year_id: year.id },
      { school_id: schoolId, student_id: omar.id, class_id: cB.id, academic_year_id: year.id },
    ]),
    'enrollments',
  )
  ok('3 élèves inscrits par le secrétariat (Yasmine en 1ère A ; Adam et Omar en 2ème A)')
  const pA = await invite(schoolId, email('parent.a'), 'Fatima Walk', 'parent')
  const pB = await invite(schoolId, email('parent.b'), 'Karim Autre', 'parent')
  must(
    await sec.from('student_guardians').insert([
      { school_id: schoolId, student_id: yas.id, guardian_member_id: pA, relationship: 'mother', is_primary: true, is_payer: true },
      { school_id: schoolId, student_id: adam.id, guardian_member_id: pA, relationship: 'mother', is_primary: true, is_payer: true },
      { school_id: schoolId, student_id: omar.id, guardian_member_id: pB, relationship: 'father', is_primary: true, is_payer: true },
    ]),
    'guardians',
  )
  ok('Fatima liée à Yasmine ET Adam (fratrie) ; Karim lié à Omar')
  await invite(schoolId, email('eleve'), 'Yasmine Walk', 'student', yas.id)
  ok('accès élève activé pour Yasmine (students.member_id → membre « student »)')

  // ------------------------------------------------------------------
  step("5. Emploi du temps versionné d'une classe + publication")
  const v1 = must(
    await dir.from('timetable_versions').insert({ school_id: schoolId, class_id: cA.id, name: 'Rentrée 2026', effective_from: '2026-09-07' }).select('id').single(),
    'version',
  )
  must(
    await dir.from('timetable_slots').insert([
      { school_id: schoolId, version_id: v1.id, class_id: cA.id, subject_id: math.id, teacher_member_id: t1, weekday: 1, starts_at: '08:30', ends_at: '09:30' },
      { school_id: schoolId, version_id: v1.id, class_id: cA.id, subject_id: arabe.id, teacher_member_id: t2, weekday: 1, starts_at: '09:30', ends_at: '10:15' },
      { school_id: schoolId, version_id: v1.id, class_id: cA.id, subject_id: math.id, teacher_member_id: t1, weekday: 3, starts_at: '08:30', ends_at: '10:00' },
    ]),
    'slots',
  )
  const clash = await dir
    .from('timetable_slots')
    .insert({ school_id: schoolId, version_id: v1.id, class_id: cA.id, subject_id: arabe.id, weekday: 1, starts_at: '09:00', ends_at: '10:00' })
  check(!!clash.error, 'créneau qui chevauche refusé par la base', clash.error?.message)
  const nadiaWeekBefore = await (await signIn(email('prof1'), 'password123')).from('timetable_slots').select('id')
  check((nadiaWeekBefore.data ?? []).length === 0, 'avant publication : le brouillon est invisible pour le professeur')
  must(await dir.rpc('publish_timetable_version', { p_version_id: v1.id }), 'publish')
  const pub = must(await dir.from('timetable_versions').select('status').eq('id', v1.id).single(), 'status')
  check(pub.status === 'published', 'version « Rentrée 2026 » publiée (3 séances)')
  const conflict = await dir.from('timetable_versions').insert({ school_id: schoolId, class_id: cB.id, name: 'Rentrée', effective_from: '2026-09-07' }).select('id').single()
  const cbSlot = await dir
    .from('timetable_slots')
    .insert({ school_id: schoolId, version_id: conflict.data.id, class_id: cB.id, subject_id: math.id, teacher_member_id: t1, weekday: 1, starts_at: '08:30', ends_at: '09:30' })
  check(!!cbSlot.error, 'professeur déjà en cours ailleurs : double réservation refusée', cbSlot.error?.message)

  // ------------------------------------------------------------------
  step("6. Une exception d'un jour (absence du prof → remplaçant)")
  const mondaySlot = must(
    await dir.from('timetable_slots').select('id').eq('version_id', v1.id).eq('weekday', 1).eq('starts_at', '08:30:00').single(),
    'slot',
  )
  must(
    await sec.from('timetable_exceptions').insert({
      school_id: schoolId,
      class_id: cA.id,
      exception_date: '2026-10-05',
      kind: 'changed',
      slot_id: mondaySlot.id,
      teacher_member_id: t2,
      reason_code: 'teacher_absent',
      reason: 'Formation',
    }),
    'exception',
  )
  const day = must(await dir.rpc('timetable_day', { p_class_id: cA.id, p_date: '2026-10-05' }), 'timetable_day')
  const m = day.find((s) => s.slot_id === mondaySlot.id)
  check(m?.status === 'changed' && m.teacher_member_id === t2, 'le 05/10 la séance de maths est « changed », assurée par Youssef ; la trame reste intacte')
  const nextMonday = must(await dir.rpc('timetable_day', { p_class_id: cA.id, p_date: '2026-10-12' }), 'next monday')
  check(nextMonday.find((s) => s.slot_id === mondaySlot.id)?.teacher_member_id === t1, 'le lundi suivant, Nadia reprend (exception d\'un seul jour)')

  // ------------------------------------------------------------------
  step('7. Annonce ciblée sur un nœud + vérification RLS')
  const ann = must(
    await sec.from('announcements').insert({ school_id: schoolId, author_member_id: staff, title: 'Sortie au musée — 1ère année', body: 'Tenue confortable.', priority: 'important' }).select('id').single(),
    'announcement',
  )
  must(await sec.from('announcement_targets').insert({ school_id: schoolId, announcement_id: ann.id, node_id: byCode.PRIM_1 }), 'target')
  const fanout = must(await sec.rpc('publish_announcement', { p_announcement_id: ann.id }), 'publish announcement')
  check(fanout === 1, `publiée ; ${fanout} message WhatsApp simulé (Fatima seulement : enfant en 1ère A)`)
  const parentA = await signIn(email('parent.a'), 'password123')
  const parentB = await signIn(email('parent.b'), 'password123')
  const seenA = must(await parentA.from('announcements').select('id').eq('id', ann.id), 'A reads')
  const seenB = must(await parentB.from('announcements').select('id').eq('id', ann.id), 'B reads')
  check(seenA.length === 1, 'Fatima (enfant sous « 1ère année primaire ») voit l\'annonce')
  check(seenB.length === 0, 'Karim (enfant en 2ème année) ne la voit pas — RLS')

  // ------------------------------------------------------------------
  step('8. Échéances + paiement partiel + statut')
  const inst = must(
    await sec
      .from('fee_installments')
      .insert([
        { school_id: schoolId, student_id: yas.id, academic_year_id: year.id, label: 'Octobre 2026', amount_due: 1500, due_on: '2026-10-10' },
        { school_id: schoolId, student_id: omar.id, academic_year_id: year.id, label: 'Octobre 2026', amount_due: 1500, due_on: '2026-10-10' },
      ])
      .select('id, student_id'),
    'installments',
  )
  const yInst = inst.find((i) => i.student_id === yas.id)
  must(await sec.from('payments').insert({ school_id: schoolId, installment_id: yInst.id, amount: 600, method: 'cash', recorded_by_member_id: staff }), 'payment')
  const bal = must(await sec.from('installment_balances').select('amount_paid, amount_remaining, payment_status').eq('id', yInst.id).single(), 'balance')
  check(bal.payment_status === 'partial' && Number(bal.amount_remaining) === 900, `statut calculé : ${bal.payment_status}, payé ${bal.amount_paid}, reste ${bal.amount_remaining}`)
  const feesA = must(await parentA.from('installment_balances').select('id'), 'parent A fees')
  check(feesA.length === 1, 'Fatima ne voit que l\'échéance de ses enfants (pas celle d\'Omar)')

  // ------------------------------------------------------------------
  step('Phase 3 · Absences : le prof fait l\'appel, parent et élève voient')
  const nadia = await signIn(email('prof1'), 'password123')
  must(
    await nadia.from('attendance_records').upsert(
      [{ school_id: schoolId, class_id: cA.id, student_id: yas.id, session_date: '2026-10-12', slot_id: mondaySlot.id, status: 'absent' }],
      { onConflict: 'student_id,session_date,slot_id' },
    ),
    'roll call',
  )
  must(
    await nadia.from('attendance_records').upsert(
      [{ school_id: schoolId, class_id: cA.id, student_id: yas.id, session_date: '2026-10-12', slot_id: mondaySlot.id, status: 'late' }],
      { onConflict: 'student_id,session_date,slot_id' },
    ),
    'roll call again',
  )
  const recs = must(await nadia.from('attendance_records').select('status').eq('student_id', yas.id), 'records')
  check(recs.length === 1 && recs[0].status === 'late', 're-saisir l\'appel met à jour (pas de doublon) : « late »')
  const other = await nadia.from('attendance_records').insert({ school_id: schoolId, class_id: cB.id, student_id: omar.id, session_date: '2026-10-12', status: 'absent' })
  check(!!other.error, 'Nadia ne peut pas faire l\'appel en 2ème A (pas sa classe)')
  const youssefSees = must(await (await signIn(email('prof2'), 'password123')).from('classes').select('name'), 'youssef classes')
  check(youssefSees.length === 2, `Youssef voit ses 2 classes (${youssefSees.map((c) => c.name).join(', ')})`)
  const nadiaSees = must(await nadia.from('classes').select('name'), 'nadia classes')
  check(nadiaSees.length === 1 && nadiaSees[0].name === '1ère A', 'Nadia ne voit que la 1ère A')
  const absA = must(await parentA.from('attendance_records').select('id, status'), 'parent A absences')
  check(absA.length === 1, 'Fatima voit le retard de Yasmine')
  must(await parentA.rpc('justify_absence', { p_record_id: (await nadia.from('attendance_records').select('id').eq('student_id', yas.id).single()).data.id, p_justification: 'Rendez-vous médical' }), 'justify')
  const afterJ = must(await parentA.from('attendance_records').select('status').single(), 'after justify')
  check(afterJ.status === 'excused', 'Fatima justifie → « excused »')
  const absB = must(await parentB.from('attendance_records').select('id'), 'parent B absences')
  check(absB.length === 0, 'Karim ne voit aucune absence de Yasmine')

  step('Phase 3 · Accès élève (lecture seule)')
  const eleve = await signIn(email('eleve'), 'password123')
  const eStudents = must(await eleve.from('students').select('first_name'), 'student self')
  check(eStudents.length === 1 && eStudents[0].first_name === 'Yasmine', 'l\'élève ne voit que sa propre fiche')
  const eSlots = must(await eleve.from('timetable_slots').select('id'), 'student slots')
  check(eSlots.length === 3, `l'élève lit l'emploi du temps publié de sa classe (${eSlots.length} séances)`)
  const eAtt = must(await eleve.from('attendance_records').select('status'), 'student attendance')
  check(eAtt.length === 1, 'l\'élève lit ses propres absences')
  must(await nadia.from('homework').insert({ school_id: schoolId, class_id: cA.id, subject_id: math.id, author_member_id: t1, title: 'Exercices p.12', body: 'Faire 1 à 4', due_on: '2026-10-14' }), 'homework')
  const eHw = must(await eleve.from('homework').select('title'), 'student homework')
  check(eHw.length === 1, 'l\'élève voit le devoir de sa classe')
  const eWrite = await eleve.from('homework').insert({ school_id: schoolId, class_id: cA.id, author_member_id: t1, title: 'x', body: 'y' })
  check(!!eWrite.error, 'l\'élève ne peut rien écrire (devoir refusé)')
  const eFees = must(await eleve.from('fee_installments').select('id'), 'student fees')
  check(eFees.length === 0, 'l\'élève ne voit pas la scolarité')

  step('Phase 3 · Réclamation : parent → secrétariat → réponse → clôture')
  const kase = must(
    await parentA.from('cases').insert({ school_id: schoolId, direction: 'parent_to_school', subject: 'Transport scolaire', student_id: yas.id, parent_member_id: pA, opened_by_member_id: pA }).select('id').single(),
    'open case',
  )
  must(await parentA.from('case_messages').insert({ school_id: schoolId, case_id: kase.id, author_member_id: pA, body: 'Le bus avait 30 minutes de retard.' }), 'first message')
  ok('Fatima ouvre un échange « Transport scolaire »')
  const seenByB = must(await parentB.from('cases').select('id'), 'B cases')
  check(seenByB.length === 0, 'Karim ne voit pas l\'échange de Fatima')
  must(await sec.from('case_messages').insert({ school_id: schoolId, case_id: kase.id, author_member_id: staff, body: 'Nous avons contacté le transporteur.' }), 'reply')
  const afterReply = must(await parentA.from('cases').select('status').eq('id', kase.id).single(), 'status')
  check(afterReply.status === 'answered', 'la réponse du secrétariat passe l\'échange en « answered »')
  const thread = must(await parentA.from('case_messages').select('body').eq('case_id', kase.id), 'thread')
  check(thread.length === 2, 'Fatima voit la réponse dans le fil')
  const outbox = must(await sec.from('notification_outbox').select('kind').eq('ref_id', kase.id), 'outbox')
  check(outbox.length === 1 && outbox[0].kind === 'case_reply', 'notification WhatsApp de la réponse consignée (envoi simulé)')
  must(await sec.from('cases').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by_member_id: staff }).eq('id', kase.id), 'resolve')
  const late = await parentA.from('case_messages').insert({ school_id: schoolId, case_id: kase.id, author_member_id: pA, body: 'encore ?' })
  check(!!late.error, 'échange clôturé : plus de message possible')

  step('Isolation entre écoles')
  const other2 = await signIn('directeur@laureats.test', 'password123').catch(() => null)
  if (other2) {
    const cross = must(await other2.from('students').select('id').eq('school_id', schoolId), 'cross')
    check(cross.length === 0, "l'admin d'une autre école (Les Lauréats) lit 0 élève de cette école")
  } else ok('(pas d\'autre école locale à comparer)')
} catch (e) {
  bad(`arrêt : ${e.message}`)
}

const header = `# Walkthrough — boucle complète sur une école neuve

Généré par \`node scripts/walkthrough.mjs\` le ${new Date().toISOString()} (run \`${run}\`).
Chaque étape s'exécute **connecté en tant que l'utilisateur réel** (directeur, secrétariat, professeurs, parents, élève) via Supabase Auth : les droits appliqués sont ceux de la RLS, comme dans l'interface.
Seule la création des comptes reproduit la fonction serveur \`inviteMember\` (clé secrète après vérification du rôle).

**Résultat : ${failures === 0 ? 'toutes les vérifications passent ✅' : `${failures} échec(s) ❌`}**
`
const out = header + log.join('\n') + '\n'
writeFileSync(new URL('../WALKTHROUGH.md', import.meta.url), out)
console.log(out)
process.exit(failures ? 1 : 0)
