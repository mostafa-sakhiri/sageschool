import { dayOf, firstFree, fromMin, slotIssues, toMin, type Horaire, type Pause } from '#/features/setup/schedule'

// Placement rules of a draft timetable, shared by the drag-and-drop editor and
// the assistant. Pure: the state and the school day come in, verdicts come out.

export type PSlot = {
  id: string
  weekday: number
  start: string // HH:MM
  end: string
  subjectId: string | null
  teacherId: string | null
  roomId: string | null
  title: string | null
}

// A database row (times as HH:MM:SS) as a planner slot
export const toPSlot = (s: {
  id: string
  weekday: number
  starts_at: string
  ends_at: string
  subject_id: string | null
  teacher_member_id: string | null
  room_id: string | null
  title: string | null
}): PSlot => ({
  id: s.id,
  weekday: s.weekday,
  start: s.starts_at.slice(0, 5),
  end: s.ends_at.slice(0, 5),
  subjectId: s.subject_id,
  teacherId: s.teacher_member_id,
  roomId: s.room_id,
  title: s.title,
})

// Where a teacher already teaches in another class (published timetables)
export type Busy = { teacherId: string; weekday: number; start: string; end: string; label: string }

export type IssueCode = 'closed_day' | 'outside_hours' | 'overlap' | 'teacher_busy' | 'pause' | 'not_found' | 'invalid'

export type Placement =
  | { level: 'ok' }
  | { level: 'bad'; code: 'closed_day' | 'outside_hours' | 'invalid' }
  | { level: 'bad'; code: 'overlap'; hit: PSlot }
  | { level: 'bad'; code: 'teacher_busy'; busy: Busy }
  | { level: 'warn'; code: 'pause'; pauses: Pause[] }

export type Env = { horaire: Horaire | null; busy: Busy[] }

const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end)

// Can a session of `teacherId` sit at `p`? Pauses only warn.
export function placement(env: Env, state: readonly PSlot[], p: { weekday: number; start: string; end: string }, ignoreId: string | null, teacherId: string | null): Placement {
  if (!/^\d\d:\d\d$/.test(p.start) || !/^\d\d:\d\d$/.test(p.end) || toMin(p.end) <= toMin(p.start) || p.weekday < 1 || p.weekday > 7)
    return { level: 'bad', code: 'invalid' }
  const issues = slotIssues(env.horaire, p.weekday, p.start, p.end)
  if (issues.closed) return { level: 'bad', code: 'closed_day' }
  if (issues.outside) return { level: 'bad', code: 'outside_hours' }
  const hit = state.find((s) => s.id !== ignoreId && s.weekday === p.weekday && overlaps(s, p))
  if (hit) return { level: 'bad', code: 'overlap', hit }
  const busy = teacherId ? env.busy.find((b) => b.teacherId === teacherId && b.weekday === p.weekday && overlaps(b, p)) : undefined
  if (busy) return { level: 'bad', code: 'teacher_busy', busy }
  if (issues.pauses.length) return { level: 'warn', code: 'pause', pauses: issues.pauses }
  return { level: 'ok' }
}

// ------------------------------------------------------------ batches of ops
// Subjects, teachers and rooms come by name, sessions by their short ref (S1…).
export type Op =
  | { op: 'move'; slot: string; weekday: number; start: string; end?: string }
  | { op: 'add'; subject: string; weekday: number; start: string; end: string; teacher?: string; room?: string; title?: string }
  | { op: 'remove'; slot: string }
  | { op: 'update'; slot: string; teacher?: string | null; room?: string | null; title?: string | null }

export type Resolved<T> = { id: T } | { error: 'not_found' | 'ambiguous'; candidates?: string[] }

export type Resolvers = {
  slot: (ref: string) => Resolved<string>
  subject: (name: string) => Resolved<string>
  teacher: (name: string) => Resolved<string>
  room: (name: string) => Resolved<string>
  // Teacher of a subject in this class ("qui enseigne quoi"), for new sessions
  defaultTeacher: (subjectId: string) => string | null
}

export type Change = { op: Op['op']; slotId: string; before: PSlot | null; after: PSlot | null }

export type Issue = {
  opIndex: number
  slotId: string | null
  level: 'bad' | 'warn'
  code: IssueCode
  // What the message needs: the name that wasn't found, the session hit, the
  // class where the teacher already is, the pauses covered…
  what?: string
  candidates?: string[]
  hit?: PSlot
  busy?: Busy
  pauses?: Pause[]
}

export type Plan = { next: PSlot[]; changes: Change[]; issues: Issue[]; ok: boolean }

// Applies every op to a copy of the state, then checks each touched session
// against the *final* state: a swap (two moves) is valid even though each
// move alone would overlap the other session.
export function planOps(ops: readonly Op[], state: readonly PSlot[], env: Env, r: Resolvers): Plan {
  let next = state.map((s) => ({ ...s }))
  const changes: Change[] = []
  const issues: Issue[] = []
  const touched = new Map<string, number>() // slot id -> op index
  let n = 0
  const lookup = <T,>(opIndex: number, res: Resolved<T>, what: string): T | null => {
    if ('id' in res) return res.id
    issues.push({ opIndex, slotId: null, level: 'bad', code: 'not_found', what, candidates: res.candidates })
    return null
  }

  ops.forEach((o, i) => {
    if (o.op === 'add') {
      const subjectId = lookup(i, r.subject(o.subject), o.subject)
      const teacherId = o.teacher ? lookup(i, r.teacher(o.teacher), o.teacher) : subjectId ? r.defaultTeacher(subjectId) : null
      const roomId = o.room ? lookup(i, r.room(o.room), o.room) : null
      if (!subjectId || (o.teacher && !teacherId) || (o.room && !roomId)) return
      const s: PSlot = { id: `new-${++n}`, weekday: o.weekday, start: o.start, end: o.end, subjectId, teacherId, roomId, title: o.title ?? null }
      next.push(s)
      changes.push({ op: 'add', slotId: s.id, before: null, after: s })
      touched.set(s.id, i)
      return
    }
    const slotId = lookup(i, r.slot(o.slot), o.slot)
    const cur = slotId ? next.find((s) => s.id === slotId) : undefined
    if (!slotId || !cur) {
      if (slotId) issues.push({ opIndex: i, slotId: null, level: 'bad', code: 'not_found', what: o.slot })
      return
    }
    const before = state.find((s) => s.id === slotId) ?? null
    if (o.op === 'remove') {
      next = next.filter((s) => s.id !== slotId)
      changes.push({ op: 'remove', slotId, before, after: null })
      touched.delete(slotId)
      return
    }
    let after: PSlot
    if (o.op === 'move') {
      const len = toMin(cur.end) - toMin(cur.start)
      const end = o.end ?? (/^\d\d:\d\d$/.test(o.start) ? fromMin(toMin(o.start) + len) : o.start)
      after = { ...cur, weekday: o.weekday, start: o.start, end }
    } else {
      const teacherId = o.teacher === undefined ? cur.teacherId : o.teacher === null ? null : lookup(i, r.teacher(o.teacher), o.teacher)
      const roomId = o.room === undefined ? cur.roomId : o.room === null ? null : lookup(i, r.room(o.room), o.room)
      if ((o.teacher && !teacherId) || (o.room && !roomId)) return
      after = { ...cur, teacherId, roomId, title: o.title === undefined ? cur.title : o.title }
    }
    next = next.map((s) => (s.id === slotId ? after : s))
    const prev = changes.find((c) => c.slotId === slotId)
    if (prev) prev.after = after
    else changes.push({ op: o.op, slotId, before, after })
    touched.set(slotId, i)
  })

  const seen = new Set<string>()
  for (const [id, opIndex] of touched) {
    const s = next.find((x) => x.id === id)!
    const v = placement(env, next, s, s.id, s.teacherId)
    if (v.level === 'ok') continue
    if (v.code === 'overlap') {
      // One issue per pair of sessions
      const pair = [s.id, v.hit.id].sort().join('|')
      if (seen.has(pair)) continue
      seen.add(pair)
    }
    issues.push({
      opIndex,
      slotId: s.id,
      level: v.level,
      code: v.code,
      hit: v.code === 'overlap' ? v.hit : undefined,
      busy: v.code === 'teacher_busy' ? v.busy : undefined,
      pauses: v.code === 'pause' ? v.pauses : undefined,
    })
  }
  issues.sort((a, b) => a.opIndex - b.opIndex)
  return { next, changes, issues, ok: changes.length > 0 && !issues.some((x) => x.level === 'bad') }
}

// Free moments of `minutes` for the class (and the teacher, when given),
// pauses skipped: the alternatives the assistant proposes.
export function freeSlots(
  env: Env,
  state: readonly PSlot[],
  days: readonly number[],
  minutes: number,
  opts: { teacherId?: string | null; weekday?: number; after?: string; before?: string; limit?: number } = {},
) {
  const out: { weekday: number; start: string; end: string }[] = []
  if (!env.horaire || minutes <= 0) return out
  for (const d of days) {
    if (opts.weekday && d !== opts.weekday) continue
    const day = dayOf(env.horaire, d)
    if (!day) continue
    const taken = [
      ...state.filter((s) => s.weekday === d),
      ...(opts.teacherId ? env.busy.filter((b) => b.teacherId === opts.teacherId && b.weekday === d) : []),
    ].map((s) => ({ start: s.start, end: s.end }))
    let from = opts.after && toMin(opts.after) > toMin(day.start) ? opts.after : day.start
    for (;;) {
      const at = firstFree(day, taken, minutes, from)
      if (!at) break
      const end = fromMin(toMin(at) + minutes)
      if (opts.before && toMin(end) > toMin(opts.before)) break
      out.push({ weekday: d, start: at, end })
      if (out.length >= (opts.limit ?? 8)) return out
      from = end
    }
  }
  return out
}
