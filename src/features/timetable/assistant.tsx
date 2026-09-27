import { useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material'
import UndoOutlined from '@mui/icons-material/UndoOutlined'
import EditCalendarOutlined from '@mui/icons-material/EditCalendarOutlined'
import { useAgentContext, useFrontendTool, useRenderTool } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { tokens } from '#/theme/theme'
import { formatDate, todayIso } from '#/lib/format'
import { formatMinutes } from '#/features/structure/api'
import { teachersQuery } from '#/features/classes/api'
import { classesQuery } from '#/features/classes/api'
import { dayOf, fromMin, toMin, type Horaire } from '#/features/setup/schedule'
import { pauseLabel } from '#/features/setup/ScheduleEditor'
import { matchOne, normTime } from '#/features/assistant/resolve'
import { PendingCard } from '#/features/assistant/tools/Card'
import { freeSlots, planOps, toPSlot, type Change, type Env, type Op, type PSlot, type Resolved, type Resolvers } from './plan'
import { describeIssue } from './describe'
import { subjectColor, versionsQuery, type Slot, type Version } from './api'
import { MiniWeek, type MiniBlock } from './MiniWeek'
import type { Band } from './WeekGrid'

// The draft timetable, driven by the assistant (use cases B1–B10 of the spec).
// The model proposes operations; plan.ts decides whether they fit; valid
// batches are written at once (a draft carries no risk, and there is undo),
// refused ones are drawn on a mini-grid with what is in the way.

// ------------------------------------------------------------------- views
// What each tool call's card draws, kept on the client (the model only gets
// words). Survives navigation: the card stays readable after leaving the page.
type TTView = {
  kind: 'change' | 'check'
  // The draft this change opened or created (published version shown)
  note?: string
  applied: boolean
  changes: string[]
  problems: string[]
  warnings: string[]
  days: number[]
  labels: Record<number, string>
  dayStart: string
  dayEnd: string
  bands: Band[]
  blocks: MiniBlock[]
  undo?: () => Promise<string | null>
}
const views = new Map<string, TTView>()
let lastApplied: string | null = null
// The version the editor shows, its sessions loaded: read by a tool that
// switches the editor to a draft (its own component remounts meanwhile)
type Snapshot = { versionId: string; state: PSlot[]; o: TimetableAssistantInput }
let latest: Snapshot | null = null

async function waitFor(ok: () => boolean, ms: number) {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
  // one more frame: the new version's tools register in an effect
  await new Promise((r) => setTimeout(r, 100))
  return ok()
}

// ------------------------------------------------------------------ writes
type Ids = { schoolId: string; classId: string; versionId: string }
const row = (s: PSlot) => ({
  weekday: s.weekday,
  starts_at: s.start,
  ends_at: s.end,
  subject_id: s.subjectId,
  teacher_member_id: s.teacherId,
  room_id: s.roomId,
  title: s.title,
})
const moved = (c: Change) => !!c.before && !!c.after && (c.before.weekday !== c.after.weekday || c.before.start !== c.after.start || c.before.end !== c.after.end)

function inverse(applied: Change[]): Change[] {
  return applied
    .map((c): Change => {
      if (c.op === 'add') return { op: 'remove', slotId: c.slotId, before: c.after, after: null }
      if (c.op === 'remove') return { op: 'add', slotId: 'undo', before: null, after: c.before }
      return { op: c.op, slotId: c.slotId, before: c.after, after: c.before }
    })
    .reverse()
}

// Writes a batch: removals, then moves, then additions. Moving several
// sessions (a swap) parks them first on Sunday night, or the database's
// overlap check would refuse the intermediate state. On a refusal, what was
// written is put back and the database's reason is returned.
async function writeChanges(changes: Change[], ids: Ids): Promise<{ applied: Change[]; error: unknown }> {
  const applied: Change[] = []
  const parked: Change[] = []
  try {
    for (const c of changes.filter((x) => x.op === 'remove')) {
      must(await supabase.from('timetable_slots').delete().eq('id', c.slotId))
      applied.push(c)
    }
    const updates = changes.filter((x) => x.before && x.after)
    const toPark = updates.filter(moved)
    if (toPark.length > 1)
      for (const [i, c] of toPark.entries()) {
        must(await supabase.from('timetable_slots').update({ weekday: 7, starts_at: fromMin(23 * 60 + i), ends_at: fromMin(23 * 60 + i + 1) }).eq('id', c.slotId))
        parked.push(c)
      }
    for (const c of updates) {
      must(await supabase.from('timetable_slots').update(row(c.after!)).eq('id', c.slotId))
      applied.push(c)
    }
    for (const c of changes.filter((x) => x.op === 'add')) {
      const id = must(
        await supabase
          .from('timetable_slots')
          .insert({ ...row(c.after!), school_id: ids.schoolId, class_id: ids.classId, version_id: ids.versionId })
          .select('id')
          .single(),
      ).id
      applied.push({ ...c, slotId: id, after: { ...c.after!, id } })
    }
    return { applied, error: null }
  } catch (error) {
    const stranded = parked.filter((p) => !applied.includes(p))
    await writeChanges([...inverse(applied), ...stranded.map((c) => ({ ...c, after: c.before }))], ids).catch(() => undefined)
    return { applied: [], error }
  }
}

async function refresh(queryClient: QueryClient, ids: Ids) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['school', ids.schoolId, 'tt-slots', ids.versionId] }),
    queryClient.invalidateQueries({ queryKey: ['school', ids.schoolId, 'tt-week'] }),
    queryClient.invalidateQueries({ queryKey: ['school', ids.schoolId, 'tt-teacher-week'] }),
  ])
}

// ----------------------------------------------------------------- schemas
const day = z.number().int().min(1).max(7).describe('Jour ISO : 1 = lundi … 6 = samedi, 7 = dimanche')
const time = z.string().describe('HH:MM')
const ref = z.string().describe('Référence de la séance, telle que dans le contexte (#xxxx)')
const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('move'), slot: ref, weekday: day, start: time, end: time.optional().describe('HH:MM ; même durée si absent') }),
  z.object({
    op: z.literal('add'),
    subject: z.string().describe('Matière (nom)'),
    weekday: day,
    start: time,
    end: time,
    teacher: z.string().optional().describe('Par défaut, le professeur de la matière dans cette classe'),
    room: z.string().optional(),
    title: z.string().optional(),
  }),
  z.object({ op: z.literal('remove'), slot: ref }),
  z.object({
    op: z.literal('update'),
    slot: ref,
    teacher: z.string().nullable().optional().describe('Nom du professeur ; null pour retirer'),
    room: z.string().nullable().optional().describe('Nom de la salle ; null pour revenir à la salle habituelle'),
    title: z.string().nullable().optional(),
  }),
])
const opsParams = z.object({ operations: z.array(opSchema).min(1).describe("Toutes les opérations d'une même demande (ex. un échange = deux déplacements)") })
const freeParams = z.object({
  minutes: z.number().int().min(5).describe('Durée cherchée en minutes'),
  subject: z.string().optional().describe('La matière : son professeur doit aussi être libre'),
  teacher: z.string().optional().describe('Un professeur qui doit être libre'),
  weekday: day.optional(),
  after: time.optional(),
  before: time.optional(),
})

// ------------------------------------------------------------------ hook
export type TimetableAssistantInput = {
  classId: string
  version: Version
  slots: Slot[]
  env: Env
  horaire: Horaire | null
  days: number[]
  labels: Record<number, string>
  dayStart: string
  dayEnd: string
  bands: Band[]
  subjects: { id: string; name: string }[]
  rooms: { id: string; name: string }[]
  names: Record<string, string>
  assignments: { subject_id: string | null; teacher_member_id: string; kind: string }[]
  required: { subject_id: string | null; weekly_minutes: number | null }[]
  // Shows another version in the editor (after a fork)
  openVersion: (id: string) => Promise<void>
}

// "#ab12" (or "ab12", or a longer prefix) → session id
function slotByRef(byRef: Map<string, string>, key: string) {
  const k = key.startsWith('#') ? key : `#${key}`
  return byRef.get(k) ?? [...byRef.entries()].find(([rk]) => rk.startsWith(k))?.[1]
}

// Short, stable reference of a session for the model: the start of its id
function refsOf(state: PSlot[]) {
  const byRef = new Map<string, string>()
  const byId = new Map<string, string>()
  for (const s of state) {
    let n = 4
    while ([...byRef.keys()].some((r) => r === `#${s.id.slice(0, n)}`)) n += 2
    byRef.set(`#${s.id.slice(0, n)}`, s.id)
    byId.set(s.id, `#${s.id.slice(0, n)}`)
  }
  return { byRef, byId }
}

// Mounted by the editor only where the assistant exists (office roles):
// its hooks need the CopilotKit provider.
export function TimetableAssistant(props: TimetableAssistantInput) {
  useTimetableAssistant(props)
  return null
}

function useTimetableAssistant(o: TimetableAssistantInput) {
  const ctx = useSchool()
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const teachers = useQuery(teachersQuery(ctx.school.id))
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const editable = o.version.status === 'draft'
  // A published version is changed through a draft the tool opens itself
  const modifiable = editable || o.version.status === 'published'
  const className = classes.data?.find((c) => c.id === o.classId)?.name ?? ''
  const state = useMemo(() => o.slots.filter((s) => !s.id.startsWith('pending-')).map(toPSlot), [o.slots])
  const refs = useMemo(() => refsOf(state), [state])

  const subjectName = (id: string | null) => o.subjects.find((s) => s.id === id)?.name
  const teacherName = (id: string | null) => (id ? (o.names[id] ?? teachers.data?.find((x) => x.id === id)?.name) : undefined)
  const roomName = (id: string | null) => o.rooms.find((r) => r.id === id)?.name
  const nameOf = (s: PSlot) => s.title || subjectName(s.subjectId) || '—'
  const when = (s: PSlot) => `${o.labels[s.weekday] ?? s.weekday} ${s.start}–${s.end}`

  // Everything the handlers read, always the latest render's
  const live = useRef({ state, refs, o, className })
  live.current = { state, refs, o, className }
  latest = { versionId: o.version.id, state, o }

  const resolve = <T extends { id: string },>(items: readonly T[], label: (x: T) => string, name: string): Resolved<string> => {
    const m = matchOne(items, label, name)
    if (m.item) return { id: m.item.id }
    return { error: m.candidates.length ? 'ambiguous' : 'not_found', candidates: m.candidates.slice(0, 5).map(label) }
  }
  // Names → ids over the sessions of `st` (refs as the model saw them in `refMap`)
  const resolvers = (x: TimetableAssistantInput = live.current.o, refMap: Map<string, string> = live.current.refs.byRef): Resolvers => {
    const teacherList = teachers.data ?? []
    return {
      slot: (key) => {
        const id = slotByRef(refMap, key)
        return id ? { id } : { error: 'not_found' }
      },
      subject: (name) => resolve(x.subjects, (s) => s.name, name),
      teacher: (name) => resolve(teacherList, (s) => s.name, name),
      room: (name) => resolve(x.rooms, (s) => s.name, name),
      defaultTeacher: (subjectId) => x.assignments.find((a) => a.subject_id === subjectId && a.kind !== 'assistant')?.teacher_member_id ?? null,
    }
  }

  // Opens the class's draft (the existing one, or a new version from today /
  // the start of the year) and waits until the editor shows it
  const openDraft = async (): Promise<{ id: string; note: string } | { error: string }> => {
    const x = live.current.o
    const versions = await queryClient.fetchQuery(versionsQuery(ctx.school.id, x.classId))
    const draft = versions.find((v) => v.status === 'draft')
    let id: string
    let note: string
    if (draft) {
      id = draft.id
      note = t('assistant.tt.draftOpened', { name: draft.name })
    } else {
      const start = ctx.year && todayIso() < ctx.year.starts_on ? ctx.year.starts_on : todayIso()
      const label = t('tt.changeFrom', { date: formatDate(start, locale) })
      try {
        id = must(await supabase.rpc('fork_timetable_version', { p_class_id: x.classId, p_from: start, p_name: label })) as string
      } catch (e) {
        return { error: errorMessage(e, t) }
      }
      note = t('assistant.tt.forked', { name: label, date: formatDate(start, locale) })
    }
    await x.openVersion(id)
    const ready = await waitFor(() => latest?.versionId === id, 8000)
    return ready ? { id, note } : { error: t('assistant.tt.draftNotReady') }
  }

  const ids = (): Ids => ({ schoolId: ctx.school.id, classId: o.classId, versionId: o.version.id })

  const run = async (kind: 'change' | 'check', ops: Op[], toolCallId: string) => {
    let { state: cur, o: x } = live.current
    const clean = ops.map((op) =>
      op.op === 'move' || op.op === 'add'
        ? { ...op, start: normTime(op.start) ?? op.start, end: op.end ? (normTime(op.end) ?? op.end) : op.end }
        : op,
    ) as Op[]
    let plan = planOps(clean, cur, x.env, resolvers())
    let target = ids()
    let note: string | undefined
    let draftError: string | null = null
    // A published version: checked as shown first (nothing is created for a
    // refused change), then the same operations go to the draft, its sessions
    // found again by their content (a copy has new ids)
    if (kind === 'change' && plan.ok && x.version.status !== 'draft') {
      const shownRefs = live.current.refs.byRef
      const shown = cur
      const d = await openDraft()
      if ('error' in d) draftError = d.error
      else if (latest) {
        const keyOf = (s: PSlot) => [s.weekday, s.start, s.end, s.subjectId, s.teacherId, s.roomId, s.title].join('|')
        const inDraft = new Map(latest.state.map((s) => [keyOf(s), s.id]))
        const carried = new Map<string, string>()
        for (const [ref, id] of shownRefs) {
          const old = shown.find((s) => s.id === id)
          const nid = old && inDraft.get(keyOf(old))
          if (nid) carried.set(ref, nid)
        }
        cur = latest.state
        x = latest.o
        plan = planOps(clean, cur, x.env, resolvers(x, carried))
        target = { ...target, versionId: d.id }
        note = d.note
      }
    }
    const helpers = { t, subjectName, teacherName: (id: string) => teacherName(id) }
    const bad = plan.issues.filter((i) => i.level === 'bad')
    const problems = bad.map((i) => {
      const s = plan.next.find((n) => n.id === i.slotId)
      return s ? `${nameOf(s)} (${when(s)}) : ${describeIssue(i, helpers)}` : describeIssue(i, helpers)
    })
    const warnings = plan.issues.filter((i) => i.level === 'warn').map((i) => {
      const s = plan.next.find((n) => n.id === i.slotId)
      return s ? `${nameOf(s)} : ${describeIssue(i, helpers)}` : describeIssue(i, helpers)
    })
    const changes = plan.changes.map((c) => {
      if (c.op === 'add') return t('assistant.tt.added', { name: nameOf(c.after!), when: when(c.after!) })
      if (c.op === 'remove') return t('assistant.tt.removed', { name: nameOf(c.before!), when: when(c.before!) })
      if (moved(c)) return t('assistant.tt.moved', { name: nameOf(c.after!), from: when(c.before!), to: when(c.after!) })
      const what = [
        c.before!.teacherId !== c.after!.teacherId ? `${t('classes.teacher')} : ${teacherName(c.after!.teacherId) ?? '—'}` : null,
        c.before!.roomId !== c.after!.roomId ? `${t('classes.room')} : ${roomName(c.after!.roomId) ?? '—'}` : null,
        c.before!.title !== c.after!.title ? `${t('tt.slotTitle')} : ${c.after!.title ?? '—'}` : null,
      ].filter(Boolean)
      return t('assistant.tt.updated', { name: nameOf(c.after!), when: when(c.after!), what: what.join(', ') })
    })

    let applied = false
    let dbError: string | null = null
    let undo: TTView['undo']
    if (kind === 'change' && plan.ok && !draftError) {
      const w = target
      const res = await writeChanges(plan.changes, w)
      await refresh(queryClient, w)
      if (res.error) dbError = errorMessage(res.error, t)
      else {
        applied = true
        lastApplied = toolCallId
        const back = inverse(res.applied)
        undo = async () => {
          const r = await writeChanges(back, w)
          await refresh(queryClient, w)
          return r.error ? errorMessage(r.error, t) : null
        }
      }
    }
    if (dbError) problems.push(dbError)
    if (draftError) problems.push(draftError)

    // The picture: the days touched, after the change (or as it would be)
    const touched = new Set<number>()
    for (const c of plan.changes) for (const s of [c.before, c.after]) if (s) touched.add(s.weekday)
    for (const i of plan.issues) {
      if (i.hit) touched.add(i.hit.weekday)
      if (i.busy) touched.add(i.busy.weekday)
    }
    const shown = [...touched].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b)
    const changedIds = new Set(plan.changes.flatMap((c) => (c.after ? [c.after.id] : [])))
    const conflictIds = new Set(bad.flatMap((i) => [i.slotId ?? '', i.hit?.id ?? '']))
    const blocks: MiniBlock[] = []
    for (const s of plan.next.filter((n) => touched.has(n.weekday)))
      blocks.push({
        key: s.id,
        weekday: s.weekday,
        start: s.start,
        end: s.end,
        title: nameOf(s),
        sub: teacherName(s.teacherId),
        color: subjectColor(s.subjectId),
        state: conflictIds.has(s.id) ? 'conflict' : changedIds.has(s.id) ? 'new' : 'normal',
      })
    for (const c of plan.changes)
      if (c.before && (!c.after || moved(c)))
        blocks.push({ key: `ghost-${c.slotId}`, weekday: c.before.weekday, start: c.before.start, end: c.before.end, title: nameOf(c.before), color: subjectColor(c.before.subjectId), state: 'ghost' })
    for (const i of bad)
      if (i.busy)
        blocks.push({
          key: `busy-${i.busy.weekday}-${i.busy.start}-${i.busy.teacherId}`,
          weekday: i.busy.weekday,
          start: i.busy.start,
          end: i.busy.end,
          title: i.busy.label,
          sub: teacherName(i.busy.teacherId),
          color: subjectColor(null),
          state: 'busy',
        })
    const ranges = shown.map((d) => (x.horaire ? dayOf(x.horaire, d) : null)).filter(Boolean) as { start: string; end: string }[]
    views.set(toolCallId, {
      kind,
      note,
      applied,
      changes,
      problems,
      warnings,
      days: shown,
      labels: x.labels,
      dayStart: ranges.length ? fromMin(Math.min(...ranges.map((r) => toMin(r.start)))) : x.dayStart,
      dayEnd: ranges.length ? fromMin(Math.max(...ranges.map((r) => toMin(r.end)))) : x.dayEnd,
      bands: x.bands.filter((b) => touched.has(b.weekday)),
      blocks,
      undo,
    })
    return JSON.stringify({
      applied,
      draft: note ?? null,
      dryRun: kind === 'check',
      valid: plan.ok && !dbError,
      changes,
      problems,
      warnings,
    })
  }

  useFrontendTool(
    {
      name: 'changeTimetable',
      description:
        "Modifier l'emploi du temps ouvert : déplacer, ajouter, supprimer une séance ou changer son professeur / sa salle. Toutes les opérations d'une demande sont appliquées ensemble si elles sont toutes possibles, sinon aucune ; le résultat dit ce qui bloque. Sur une version publiée, crée ou rouvre lui-même le brouillon avant d'appliquer : ne demande pas de confirmation. L'utilisateur peut annuler.",
      parameters: opsParams,
      available: modifiable,
      handler: async ({ operations }, { toolCall }) => run('change', operations as Op[], toolCall.id),
    },
    [modifiable, o.version.id],
  )
  useFrontendTool(
    {
      name: 'checkTimetable',
      description: "Vérifier sans rien modifier si des opérations sur l'emploi du temps seraient possibles, et pourquoi pas (« pourquoi je ne peux pas… »).",
      parameters: opsParams,
      available: modifiable,
      handler: async ({ operations }, { toolCall }) => run('check', operations as Op[], toolCall.id),
    },
    [modifiable, o.version.id],
  )
  useFrontendTool(
    {
      name: 'findFreeSlots',
      description: "Trouver les moments libres de la classe (pauses exclues), et du professeur s'il est donné, pour proposer une alternative.",
      parameters: freeParams,
      available: modifiable,
      handler: async (a) => {
        const { state: cur, o: x } = live.current
        const r = resolvers()
        let teacherId: string | null = null
        if (a.teacher) {
          const m = r.teacher(a.teacher)
          if (!('id' in m)) return JSON.stringify({ error: t('assistant.notFound', { what: a.teacher }) })
          teacherId = m.id
        } else if (a.subject) {
          const m = r.subject(a.subject)
          if (!('id' in m)) return JSON.stringify({ error: t('assistant.notFound', { what: a.subject }) })
          teacherId = r.defaultTeacher(m.id)
        }
        const free = freeSlots(x.env, cur, x.days, a.minutes, {
          teacherId,
          weekday: a.weekday,
          after: normTime(a.after) ?? undefined,
          before: normTime(a.before) ?? undefined,
          limit: 8,
        })
        return JSON.stringify({ teacher: teacherName(teacherId) ?? null, free: free.map((f) => ({ weekday: f.weekday, day: x.labels[f.weekday], start: f.start, end: f.end })) })
      },
    },
    [modifiable, teachers.data],
  )
  useFrontendTool(
    {
      name: 'undoTimetableChange',
      description: "Annuler la dernière modification de l'emploi du temps faite par l'assistant.",
      available: editable,
      handler: async () => {
        const v = lastApplied ? views.get(lastApplied) : undefined
        if (!v?.undo) return JSON.stringify({ undone: false, reason: 'nothing to undo' })
        const err = await v.undo()
        if (!err) {
          v.undo = undefined
          lastApplied = null
        }
        return JSON.stringify({ undone: !err, error: err })
      },
    },
    [editable],
  )

  // The timetable as the model sees it, compact (it is sent with every
  // request): one line per day with its sessions and refs, the subjects
  // still to place, the teachers' other classes.
  const placed = new Map<string, number>()
  for (const s of state) if (s.subjectId) placed.set(s.subjectId, (placed.get(s.subjectId) ?? 0) + toMin(s.end) - toMin(s.start))
  const who = (id: string | null) => {
    const n = teacherName(id)
    return n ? ` (${n})` : ''
  }
  const lines = [
    `Classe : ${className} · version « ${o.version.name} » · ${
      editable
        ? 'brouillon, modifiable'
        : o.version.status === 'published'
          ? "publiée : changeTimetable crée ou rouvre lui-même le brouillon, n'en parle pas et ne demande pas de confirmation"
          : 'archivée, lecture seule'
    }`,
    'Jours (weekday : horaires ; pauses, non modifiables) :',
    ...o.days.map((d) => {
      const day = o.horaire ? dayOf(o.horaire, d) : null
      const pauses = day?.pauses.map((p) => `${pauseLabel(p, t)} ${p.start}–${p.end}`).join(', ')
      return `${d} ${o.labels[d]} : ${day ? `${day.start}–${day.end}` : `${o.dayStart}–${o.dayEnd}`}${pauses ? ` ; ${pauses}` : ''}`
    }),
    'Séances (réf début–fin matière « titre » (prof) [salle]) :',
    ...o.days.map(
      (d) =>
        `${d} ${o.labels[d]} : ` +
        (state
          .filter((s) => s.weekday === d)
          .map((s) => `${refs.byId.get(s.id)} ${s.start}–${s.end} ${subjectName(s.subjectId) ?? '—'}${s.title ? ` « ${s.title} »` : ''}${who(s.teacherId)}${s.roomId ? ` [${roomName(s.roomId)}]` : ''}`)
          .join(' ; ') || '—'),
    ),
    'Matières (placé / programme) : ' +
      o.required
        .filter((r) => r.subject_id)
        .map(
          (r) =>
            `${subjectName(r.subject_id) ?? '—'} ${formatMinutes(placed.get(r.subject_id!) ?? 0, locale)}/${formatMinutes(r.weekly_minutes ?? 0, locale)}${who(o.assignments.find((a) => a.subject_id === r.subject_id && a.kind !== 'assistant')?.teacher_member_id ?? null)}`,
        )
        .join(' ; '),
    ...(o.env.busy.length
      ? ['Professeurs pris dans une autre classe : ' + o.env.busy.map((b) => `${teacherName(b.teacherId) ?? '—'} ${b.weekday} ${b.start}–${b.end} (${b.label})`).join(' ; ')]
      : []),
    ...(o.rooms.length ? [`Salles : ${o.rooms.map((r) => r.name).join(', ')}`] : []),
  ]
  useAgentContext({ description: "L'emploi du temps ouvert à l'écran", value: lines.join('\n') })
}

// ---------------------------------------------------------------- the card
// Registered with the global tools, so cards stay drawn after leaving the page.
export function TimetableRenderers() {
  useRenderTool({ name: 'changeTimetable', parameters: opsParams, render: (p) => <TimetableCard toolCallId={p.toolCallId} status={p.status} /> })
  useRenderTool({ name: 'checkTimetable', parameters: opsParams, render: (p) => <TimetableCard toolCallId={p.toolCallId} status={p.status} /> })
  useRenderTool({
    name: 'findFreeSlots',
    parameters: freeParams,
    render: (p) => (p.status === 'complete' ? <FreeSlots result={p.result} /> : null),
  })
  useRenderTool({ name: 'undoTimetableChange', parameters: z.object({}), render: (p) => (p.status === 'complete' ? <UndoLine result={p.result} /> : null) })
  return null
}

function TimetableCard({ toolCallId, status }: { toolCallId: string; status: string }) {
  const { t } = useI18n()
  const [undoState, setUndoState] = useState<'idle' | 'busy' | 'done' | string>('idle')
  if (status !== 'complete') return <PendingCard label={t('assistant.tt.checking')} />
  const v = views.get(toolCallId)
  if (!v) return null
  const refused = !v.applied && v.problems.length > 0
  return (
    <Stack spacing={1} sx={{ p: 1.5, borderRadius: 3, border: `1px solid ${refused ? tokens.dangerLine : tokens.line}`, bgcolor: tokens.surface }}>
      {v.note && (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: tokens.accentDark }}>
          <EditCalendarOutlined sx={{ fontSize: 16 }} />
          <Typography sx={{ fontSize: 12.5, fontWeight: 500 }}>{v.note}</Typography>
        </Stack>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Chip
          size="small"
          label={
            v.applied
              ? undoState === 'done'
                ? t('assistant.tt.undone')
                : t('assistant.tt.applied')
              : refused
                ? v.kind === 'check'
                  ? t('assistant.tt.notPossible')
                  : t('assistant.tt.notApplied')
                : t('assistant.tt.possible')
          }
          sx={{
            fontWeight: 600,
            bgcolor: refused ? tokens.dangerSoft : v.applied && undoState !== 'done' ? tokens.accentSoft : tokens.fill,
            color: refused ? tokens.dangerInk : v.applied && undoState !== 'done' ? tokens.accentDark : tokens.inkSoft,
          }}
        />
        <Box sx={{ flex: 1 }} />
        {v.applied && v.undo && undoState !== 'done' && (
          <Button
            size="small"
            startIcon={<UndoOutlined />}
            loading={undoState === 'busy'}
            onClick={async () => {
              setUndoState('busy')
              const err = await v.undo!()
              if (!err) {
                v.undo = undefined
                if (lastApplied === toolCallId) lastApplied = null
              }
              setUndoState(err ?? 'done')
            }}
          >
            {t('tt.undo')}
          </Button>
        )}
      </Stack>
      {v.changes.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: 13, color: refused ? tokens.inkMuted : tokens.ink }}>
          {v.changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </Box>
      )}
      {v.problems.map((p, i) => (
        <Alert key={`p${i}`} severity="error" sx={{ py: 0 }}>
          {p}
        </Alert>
      ))}
      {v.warnings.map((w, i) => (
        <Alert key={`w${i}`} severity="warning" sx={{ py: 0 }}>
          {w}
        </Alert>
      ))}
      {typeof undoState === 'string' && !['idle', 'busy', 'done'].includes(undoState) && (
        <Alert severity="error" sx={{ py: 0 }}>
          {undoState}
        </Alert>
      )}
      {v.days.length > 0 && <MiniWeek days={v.days} labels={v.labels} dayStart={v.dayStart} dayEnd={v.dayEnd} blocks={v.blocks} bands={v.bands} />}
      {v.blocks.some((b) => b.state !== 'normal') && <Legend blocks={v.blocks} />}
    </Stack>
  )
}

function Legend({ blocks }: { blocks: MiniBlock[] }) {
  const { t } = useI18n()
  const has = (s: MiniBlock['state']) => blocks.some((b) => b.state === s)
  const item = (label: string, sx: object) => (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Box sx={{ width: 12, height: 9, borderRadius: '3px', ...sx }} />
      <Typography sx={{ fontSize: 11, color: tokens.inkMuted }}>{label}</Typography>
    </Stack>
  )
  return (
    <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
      {has('new') && item(t('assistant.tt.legendNew'), { border: `2px solid ${tokens.accent}` })}
      {has('ghost') && item(t('assistant.tt.legendGhost'), { border: `1.5px dashed ${tokens.lineStrong}` })}
      {has('conflict') && item(t('assistant.tt.legendConflict'), { border: `1.5px solid ${tokens.dangerInk}`, bgcolor: tokens.dangerSoft })}
      {has('busy') && item(t('assistant.tt.legendBusy'), { border: `1.5px solid ${tokens.dangerInk}`, backgroundImage: `repeating-linear-gradient(45deg, transparent 0 3px, ${tokens.dangerLine} 3px 5px)` })}
    </Stack>
  )
}

function FreeSlots({ result }: { result: string }) {
  const { t } = useI18n()
  let r: { free?: { day: string; start: string; end: string }[] } = {}
  try {
    r = JSON.parse(result)
  } catch {
    return null
  }
  if (!r.free) return null
  if (!r.free.length) return <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{t('assistant.tt.noFree')}</Typography>
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
      {r.free.map((f, i) => (
        <Chip key={i} size="small" variant="outlined" label={`${f.day} ${f.start}–${f.end}`} />
      ))}
    </Stack>
  )
}

function UndoLine({ result }: { result: string }) {
  const { t } = useI18n()
  let r: { undone?: boolean } = {}
  try {
    r = JSON.parse(result)
  } catch {
    return null
  }
  return <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>↶ {r.undone ? t('assistant.tt.undone') : t('assistant.tt.nothingToUndo')}</Typography>
}
