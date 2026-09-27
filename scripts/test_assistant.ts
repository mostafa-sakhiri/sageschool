// Checks the assistant's deterministic parts: name matching and the draft
// timetable planner (moves, swaps, conflicts, free slots).
// Run: npm run test:assistant
import assert from 'node:assert/strict'
import { matchOne, normDate, normTime } from '../src/features/assistant/resolve.ts'
import { freeSlots, planOps, type Env, type PSlot, type Resolvers } from '../src/features/timetable/plan.ts'
import type { Horaire } from '../src/features/setup/schedule.ts'

let passed = 0
const ok = (msg: string) => {
  passed++
  console.log(`✓ ${msg}`)
}

// ------------------------------------------------------------- name matching
const teachers = [
  { id: 't1', name: 'Salma Idrissi' },
  { id: 't2', name: 'Sarah Lahlou' },
  { id: 't3', name: 'Houda Bennani' },
  { id: 't4', name: 'Nora El Fassi' },
]
const byName = (q: string) => matchOne(teachers, (x) => x.name, q)
assert.equal(byName('Salma Idrissi').item?.id, 't1')
assert.equal(byName('Mme Idrissi').item?.id, 't1')
assert.equal(byName('idrissi').item?.id, 't1')
assert.equal(byName('SARAH').item?.id, 't2')
assert.equal(byName('el fassi').item?.id, 't4')
assert.equal(byName('Dupont').item, null)
assert.equal(byName('').item, null)
ok('teachers: full name, civility + last name, case and accents')

const twoSarahs = [...teachers, { id: 't5', name: 'Sarah Benjelloun' }]
const amb = matchOne(twoSarahs, (x) => x.name, 'Sarah')
assert.equal(amb.item, null)
assert.equal(amb.candidates.length, 2)
ok('two matches: ambiguous, both candidates returned, no guess')

const subjects = [
  { id: 's1', name: 'Éveil à l’anglais' },
  { id: 's2', name: 'Motricité' },
  { id: 's3', name: 'Pâte à modeler' },
]
assert.equal(matchOne(subjects, (x) => x.name, 'anglais').item?.id, 's1')
assert.equal(matchOne(subjects, (x) => x.name, 'motricite').item?.id, 's2')
assert.equal(matchOne(subjects, (x) => x.name, 'pate a modeler').item?.id, 's3')
ok('subjects: partial words and missing accents')

assert.equal(normTime('9h'), '09:00')
assert.equal(normTime('9h30'), '09:30')
assert.equal(normTime('14:05'), '14:05')
assert.equal(normTime('25:00'), null)
assert.equal(normDate('2026-10-03'), '2026-10-03')
assert.equal(normDate('2026-02-30'), null)
assert.equal(normDate('03/10/2026'), null)
ok('times and dates: normalized or refused, never misread')

// ------------------------------------------------------------------ planner
// Préscolaire day: 08:30-16:30, pauses; Friday until 12:30; Wednesday closed.
const horaire: Horaire = {
  id: 'h',
  name: 'Préscolaire',
  cycles: [],
  days: ['1', '2', '4', '5'],
  base: {
    start: '08:30',
    end: '16:30',
    pauses: [
      { kind: 'snack', start: '09:00', end: '09:30' },
      { kind: 'lunch', start: '11:30', end: '12:30' },
      { kind: 'nap', start: '12:30', end: '14:00' },
    ],
  },
  overrides: { '5': { start: '08:30', end: '12:30', pauses: [{ kind: 'snack', start: '09:00', end: '09:30' }] } },
}
const slot = (id: string, weekday: number, start: string, end: string, subjectId: string, teacherId: string | null = 't1'): PSlot => ({
  id,
  weekday,
  start,
  end,
  subjectId,
  teacherId,
  roomId: null,
  title: null,
})
const state: PSlot[] = [
  slot('a', 1, '09:30', '10:30', 's2'), // Monday motricité
  slot('b', 2, '09:30', '10:30', 's3'), // Tuesday pâte à modeler
  slot('c', 1, '10:30', '11:30', 's1', 't2'), // Monday English (Sarah)
]
const env: Env = {
  horaire,
  busy: [{ teacherId: 't2', weekday: 4, start: '10:00', end: '11:00', label: 'Moyenne section' }],
}
const refs: Record<string, string> = { S1: 'a', S2: 'b', S3: 'c' }
const r: Resolvers = {
  slot: (ref) => (refs[ref] ? { id: refs[ref] } : { error: 'not_found' }),
  subject: (name) => {
    const m = matchOne(subjects, (x) => x.name, name)
    return m.item ? { id: m.item.id } : { error: m.candidates.length ? 'ambiguous' : 'not_found', candidates: m.candidates.map((x) => x.name) }
  },
  teacher: (name) => {
    const m = matchOne(teachers, (x) => x.name, name)
    return m.item ? { id: m.item.id } : { error: 'not_found' }
  },
  room: () => ({ error: 'not_found' }),
  defaultTeacher: (s) => (s === 's1' ? 't2' : 't1'),
}

let p = planOps([{ op: 'move', slot: 'S1', weekday: 4, start: '09:30' }], state, env, r)
assert.equal(p.ok, true)
assert.deepEqual(p.issues, [])
assert.equal(p.next.find((s) => s.id === 'a')?.end, '10:30', 'a move keeps the length')
assert.equal(p.changes.length, 1)
ok('move to a free moment: valid, length kept')

p = planOps(
  [
    { op: 'move', slot: 'S1', weekday: 2, start: '09:30' },
    { op: 'move', slot: 'S2', weekday: 1, start: '09:30' },
  ],
  state,
  env,
  r,
)
assert.equal(p.ok, true, 'a swap is valid: checked on the final state')
ok('swap of two sessions: valid although each move alone overlaps')

p = planOps([{ op: 'move', slot: 'S1', weekday: 1, start: '10:00' }], state, env, r)
assert.equal(p.ok, false)
assert.equal(p.issues[0].code, 'overlap')
assert.equal(p.issues[0].hit?.id, 'c')
ok('overlap with another session of the class: refused, names the session')

p = planOps([{ op: 'move', slot: 'S3', weekday: 4, start: '10:30' }], state, env, r)
assert.equal(p.ok, false)
assert.equal(p.issues[0].code, 'teacher_busy')
assert.equal(p.issues[0].busy?.label, 'Moyenne section')
ok('teacher already teaching in another class: refused, names the class')

p = planOps([{ op: 'move', slot: 'S1', weekday: 3, start: '09:30' }], state, env, r)
assert.equal(p.issues[0].code, 'closed_day')
p = planOps([{ op: 'move', slot: 'S1', weekday: 5, start: '12:00' }], state, env, r)
assert.equal(p.issues[0].code, 'outside_hours', 'Friday ends at 12:30')
p = planOps([{ op: 'move', slot: 'S1', weekday: 1, start: '11:00', end: '10:00' }], state, env, r)
assert.equal(p.issues[0].code, 'invalid')
ok('closed day, outside the day (short Friday), end before start: refused')

p = planOps([{ op: 'move', slot: 'S1', weekday: 4, start: '09:00', end: '10:00' }], state, env, r)
assert.equal(p.ok, true)
assert.equal(p.issues[0].level, 'warn')
assert.equal(p.issues[0].code, 'pause')
ok('over a pause: applied with a warning (same rule as a manual drag)')

p = planOps([{ op: 'add', subject: 'anglais', weekday: 2, start: '14:00', end: '15:00' }], state, env, r)
assert.equal(p.ok, true)
assert.equal(p.changes[0].after?.teacherId, 't2', 'new session: teacher from "qui enseigne quoi"')
p = planOps([{ op: 'add', subject: 'anglais', weekday: 4, start: '10:00', end: '11:00' }], state, env, r)
assert.equal(p.issues[0].code, 'teacher_busy', 'the default teacher is checked too')
ok('add: default teacher, checked against their other classes')

p = planOps([{ op: 'add', subject: 'Chant', weekday: 2, start: '14:00', end: '15:00' }], state, env, r)
assert.equal(p.ok, false)
assert.equal(p.issues[0].code, 'not_found')
assert.equal(p.issues[0].what, 'Chant')
p = planOps([{ op: 'move', slot: 'S9', weekday: 2, start: '14:00' }], state, env, r)
assert.equal(p.issues[0].code, 'not_found')
ok('unknown subject or session: not_found, nothing guessed')

p = planOps([{ op: 'update', slot: 'S1', teacher: 'Sarah Lahlou' }], state, env, r)
assert.equal(p.ok, true)
assert.equal(p.next.find((s) => s.id === 'a')?.teacherId, 't2')
p = planOps(
  [
    { op: 'move', slot: 'S1', weekday: 4, start: '10:00' },
    { op: 'update', slot: 'S1', teacher: 'Sarah' },
  ],
  state,
  env,
  r,
)
assert.equal(p.issues[0].code, 'teacher_busy', 'moving then changing the teacher: checked at the new place')
assert.equal(p.changes.length, 1, 'one change per session')
ok('update teacher: applied, checked against the teacher’s other classes')

p = planOps([{ op: 'remove', slot: 'S2' }], state, env, r)
assert.equal(p.ok, true)
assert.equal(p.next.length, 2)
ok('remove')

// ----------------------------------------------------------- free moments
let free = freeSlots(env, state, [1, 2, 3, 4, 5], 60, { weekday: 1 })
assert.deepEqual(free.map((f) => f.start), ['14:00', '15:00'], 'Monday: after the nap only (morning full, pauses skipped)')
free = freeSlots(env, state, [1, 2, 3, 4, 5], 60, { weekday: 4, teacherId: 't2' })
assert.ok(free.every((f) => f.end <= '10:00' || f.start >= '11:00'), 'Sarah is busy in MS on Thursday 10:00-11:00')
free = freeSlots(env, state, [1, 2, 3, 4, 5], 60, { weekday: 3 })
assert.deepEqual(free, [], 'closed day')
ok('free moments: pauses, class sessions and the teacher’s other classes skipped')

console.log(`\n${passed} checks passed`)
