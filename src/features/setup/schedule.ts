import type { Node } from '#/features/structure/api'

// The school day, per cycle (stored in schools.settings.schedules).
// A school with a préscolaire and a primaire rarely shares one timetable
// skeleton: the little ones have accueil, goûter, sieste and an early Friday,
// the primaire has its récréations. Each "horaire" applies to one or more
// curriculum node codes (usually cycles); a class uses the horaire of the
// most specific node on its path. Each horaire has a typical day ("base") and
// per-weekday overrides (Friday ends at 12:30, recess later on Wednesday...).
// Pauses are the non-teaching moments: récréation, déjeuner, and in
// préscolaire the routines (accueil, goûter, sieste, change, sortie). They are
// shown in every class timetable and excluded from the teachable time.

export const PAUSE_KINDS = ['welcome', 'snack', 'recess', 'lunch', 'nap', 'care', 'dismissal', 'other'] as const
export type PauseKind = (typeof PAUSE_KINDS)[number]
export type Pause = { kind: PauseKind; label?: string; start: string; end: string }
export type DaySchedule = { start: string; end: string; pauses: Pause[] }
export type Horaire = {
  id: string
  name: string
  cycles: string[] // node codes; [] = every class not covered by another horaire
  days: string[] // ISO weekdays '1'..'7' the school is open
  base: DaySchedule
  overrides: Record<string, DaySchedule> // weekday -> its own day
  rollCall?: 'day' | 'session' // préscolaire: one roll call per day
}

export const WEEKDAYS = ['1', '2', '3', '4', '5', '6'] as const

export const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + (m || 0)
}
export const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// Legacy shape (before per-cycle horaires): one school-wide opening.
type LegacyOpening = { days: string[]; day: [string, string]; lunch?: [string, string]; recess?: [string, string] }

export function readHoraires(settings: unknown): Horaire[] {
  const s = (settings ?? {}) as { schedules?: Horaire[]; opening?: LegacyOpening }
  if (Array.isArray(s.schedules) && s.schedules.length) return s.schedules.map(normalize)
  const o = s.opening
  if (!o) return []
  const pauses: Pause[] = []
  if (o.recess && o.recess[1] > o.recess[0]) pauses.push({ kind: 'recess', start: o.recess[0], end: o.recess[1] })
  if (o.lunch && o.lunch[1] > o.lunch[0]) pauses.push({ kind: 'lunch', start: o.lunch[0], end: o.lunch[1] })
  return [
    normalize({ id: 'default', name: '', cycles: [], days: o.days, base: { start: o.day[0], end: o.day[1], pauses }, overrides: {} }),
  ]
}

function normalize(h: Horaire): Horaire {
  const sortDay = (d: DaySchedule): DaySchedule => ({ ...d, pauses: [...(d.pauses ?? [])].sort((a, b) => toMin(a.start) - toMin(b.start)) })
  return {
    ...h,
    cycles: h.cycles ?? [],
    days: [...(h.days ?? [])].sort(),
    base: sortDay(h.base),
    overrides: Object.fromEntries(Object.entries(h.overrides ?? {}).map(([k, v]) => [k, sortDay(v)])),
  }
}

export function dayOf(h: Horaire, weekday: number | string): DaySchedule | null {
  const d = String(weekday)
  if (!h.days.includes(d)) return null
  return h.overrides[d] ?? h.base
}

// Minutes of a pause that fall inside the day (a pause may be mistyped outside).
function clipped(p: Pause, d: DaySchedule) {
  return Math.max(0, Math.min(toMin(p.end), toMin(d.end)) - Math.max(toMin(p.start), toMin(d.start)))
}

// Teachable minutes of a day: opening hours minus pauses (overlaps counted once).
export function teachableMinutes(d: DaySchedule) {
  const span = toMin(d.end) - toMin(d.start)
  if (span <= 0) return 0
  const ranges = d.pauses
    .filter((p) => clipped(p, d) > 0)
    .map((p) => [Math.max(toMin(p.start), toMin(d.start)), Math.min(toMin(p.end), toMin(d.end))])
    .sort((a, b) => a[0] - b[0])
  let off = 0
  let cur = -1
  for (const [s, e] of ranges) {
    const from = Math.max(s, cur)
    if (e > from) off += e - from
    cur = Math.max(cur, e)
  }
  return Math.max(0, span - off)
}

export function weeklyTeachable(h: Horaire) {
  return h.days.reduce((sum, d) => sum + teachableMinutes(dayOf(h, d)!), 0)
}

// Horaire of a node (class level): the horaire naming the deepest node of its
// path wins; otherwise the catch-all one (cycles = []); otherwise the first.
export function horaireForNode(horaires: Horaire[], nodes: Pick<Node, 'id' | 'code' | 'path'>[], nodeId: string | null | undefined) {
  if (!horaires.length) return null
  const node = nodes.find((n) => n.id === nodeId)
  if (node) {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const id of [...node.path].reverse()) {
      const code = byId.get(id)?.code
      const h = code ? horaires.find((x) => x.cycles.includes(code)) : undefined
      if (h) return h
    }
  }
  return horaires.find((h) => h.cycles.length === 0) ?? horaires[0]
}

// Grid bounds for several horaires at once (a teacher across cycles).
export function unionBounds(horaires: Horaire[]) {
  const days = new Set<number>()
  let start = Infinity
  let end = -Infinity
  for (const h of horaires)
    for (const d of h.days) {
      const day = dayOf(h, d)!
      days.add(Number(d))
      start = Math.min(start, toMin(day.start))
      end = Math.max(end, toMin(day.end))
    }
  if (!days.size) return { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' }
  return { days: [...days].sort((a, b) => a - b), start: fromMin(start), end: fromMin(end) }
}

// Where would a slot land badly? Outside the day, on a closed day, over a pause.
export function slotIssues(h: Horaire | null, weekday: number, start: string, end: string) {
  if (!h || !start || !end) return { closed: false, outside: false, pauses: [] as Pause[] }
  const d = dayOf(h, weekday)
  if (!d) return { closed: true, outside: false, pauses: [] as Pause[] }
  const s = toMin(start)
  const e = toMin(end)
  return {
    closed: false,
    outside: s < toMin(d.start) || e > toMin(d.end),
    pauses: d.pauses.filter((p) => toMin(p.start) < e && s < toMin(p.end)),
  }
}

// First free moment of a day, after `from`, that fits `len` minutes between
// pauses and already placed sessions.
export function firstFree(d: DaySchedule, taken: { start: string; end: string }[], len: number, from = d.start) {
  const busy = [...d.pauses, ...taken].map((b) => [toMin(b.start), toMin(b.end)]).sort((a, b) => a[0] - b[0])
  let t = Math.max(toMin(from), toMin(d.start))
  for (;;) {
    const hit = busy.find(([s, e]) => s < t + len && t < e)
    if (!hit) break
    t = hit[1]
  }
  return t + len <= toMin(d.end) ? fromMin(t) : null
}

// ---------------------------------------------------------------- presets
// Starting points by cycle, adjusted by the school in the wizard.
// Préscolaire: the day of a typical Moroccan private préscolaire (Ptichou's
// petite section): 3 h 30 of activities a day, Friday until 12:30.
const PRESCO_BASE: DaySchedule = {
  start: '08:30',
  end: '16:30',
  pauses: [
    { kind: 'welcome', start: '08:30', end: '09:00' },
    { kind: 'snack', start: '09:00', end: '09:30' },
    { kind: 'lunch', start: '11:30', end: '12:30' },
    { kind: 'nap', start: '12:30', end: '14:00' },
    { kind: 'care', start: '14:00', end: '14:30' },
    { kind: 'dismissal', start: '16:00', end: '16:30' },
  ],
}
const PRESCO_FRIDAY: DaySchedule = {
  start: '08:30',
  end: '12:30',
  pauses: [
    { kind: 'welcome', start: '08:30', end: '09:00' },
    { kind: 'snack', start: '09:00', end: '09:30' },
    { kind: 'dismissal', start: '11:30', end: '12:30' },
  ],
}
const PRIM_BASE: DaySchedule = {
  start: '08:30',
  end: '16:30',
  pauses: [
    { kind: 'recess', start: '10:15', end: '10:30' },
    { kind: 'lunch', start: '12:30', end: '14:00' },
    { kind: 'recess', start: '15:15', end: '15:30' },
  ],
}
const SECONDARY_BASE: DaySchedule = {
  start: '08:00',
  end: '18:00',
  pauses: [
    { kind: 'recess', start: '10:00', end: '10:15' },
    { kind: 'lunch', start: '12:00', end: '14:00' },
    { kind: 'recess', start: '16:00', end: '16:15' },
  ],
}

export function presetHoraire(cycleCode: string, name: string): Horaire {
  const common = { id: cycleCode, name, cycles: [cycleCode], days: ['1', '2', '3', '4', '5'] }
  if (cycleCode === 'PRESCO')
    return { ...common, base: PRESCO_BASE, overrides: { '5': PRESCO_FRIDAY }, rollCall: 'day' }
  if (cycleCode === 'PRIM') return { ...common, base: PRIM_BASE, overrides: {}, rollCall: 'session' }
  return { ...common, base: SECONDARY_BASE, overrides: {}, rollCall: 'session' }
}
