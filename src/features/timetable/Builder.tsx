import { useEffect, useMemo, useState, type PointerEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Popover,
  Snackbar,
  SnackbarContent,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
import DragIndicatorOutlined from '@mui/icons-material/DragIndicatorOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDate, hhmm, todayIso } from '#/lib/format'
import { formatMinutes, roomsQuery, subjectsQuery } from '#/features/structure/api'
import { assignmentsQuery, requiredHoursQuery, teachersQuery } from '#/features/classes/api'
import { EmptyState, ErrorState, Loading } from '#/components/states'
import { Tag } from '#/components/ui'
import { WeekGrid, type Block } from './WeekGrid'
import { membersNamesQuery, slotsQuery, subjectColor, teachersBusyQuery, versionsQuery, type Slot, type Version } from './api'
import { Planner, Range, type NewItem, type Place, type PlannerSlot, type Verdict } from './Planner'
import { useSchoolDays } from './RealWeek'
import { dayOf, firstFree, fromMin, slotIssues, weeklyTeachable } from '#/features/setup/schedule'
import { pauseLabel } from '#/features/setup/ScheduleEditor'
import { tokens } from '#/theme/theme'

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Versioned timetable (schema §7): a draft is edited freely, then published;
// publishing closes the previous version the day before. A published version
// is never edited in place: "Nouvelle version" forks it from a date.
export function Builder({ classId }: { classId: string }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const versions = useQuery(versionsQuery(ctx.school.id, classId))
  const [versionId, setVersionId] = useState<string | null>(null)
  const [forkOpen, setForkOpen] = useState(false)

  useEffect(() => setVersionId(null), [classId])
  const list = versions.data ?? []
  const current = list.find((v) => v.id === versionId) ?? list.find((v) => v.status === 'draft') ?? list[0]

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-versions', classId] }),
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-week'] }),
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-teacher-week'] }),
    ])

  const createFirst = useMutation({
    mutationFn: async () =>
      must(
        await supabase
          .from('timetable_versions')
          .insert({
            school_id: ctx.school.id,
            class_id: classId,
            name: t('tt.firstVersionName', { year: ctx.year?.name ?? '' }),
            effective_from: ctx.year!.starts_on,
            created_by_member_id: ctx.member.id,
          })
          .select('id')
          .single(),
      ),
    onSuccess: async (v) => {
      await invalidate()
      setVersionId(v.id)
    },
  })
  const publish = useMutation({
    mutationFn: async (id: string) => must(await supabase.rpc('publish_timetable_version', { p_version_id: id })),
    onSuccess: invalidate,
  })
  const discard = useMutation({
    mutationFn: async (id: string) => must(await supabase.from('timetable_versions').delete().eq('id', id)),
    onSuccess: async () => {
      setVersionId(null)
      await invalidate()
    },
  })

  if (versions.isPending) return <Loading rows={5} />
  if (versions.isError) return <ErrorState error={versions.error} onRetry={() => versions.refetch()} />
  if (!list.length)
    return (
      <EmptyState
        title={t('tt.noVersion')}
        hint={t('tt.noVersionHint')}
        action={
          <Button variant="contained" onClick={() => createFirst.mutate()} loading={createFirst.isPending} disabled={!ctx.year}>
            {t('tt.createFirst')}
          </Button>
        }
      />
    )

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' } }}>
          <TextField
            select
            label={t('tt.version')}
            value={current?.id ?? ''}
            onChange={(e) => setVersionId(e.target.value)}
            sx={{ minWidth: 320 }}
          >
            {list.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name} · {t(`tt.status.${v.status}`)} · {formatDate(v.effective_from, locale)}
                {v.effective_to ? ` → ${formatDate(v.effective_to, locale)}` : ''}
              </MenuItem>
            ))}
          </TextField>
          {current && <StatusTag v={current} />}
          <Box sx={{ flex: 1 }} />
          {current?.status === 'draft' && (
            <>
              <Button color="error" onClick={() => discard.mutate(current.id)} loading={discard.isPending}>
                {t('tt.discard')}
              </Button>
              <Button variant="contained" onClick={() => publish.mutate(current.id)} loading={publish.isPending}>
                {t('tt.publish')}
              </Button>
            </>
          )}
          {current?.status === 'published' && (
            <Button variant="outlined" onClick={() => setForkOpen(true)}>
              {t('tt.newVersion')}
            </Button>
          )}
        </Stack>
        {current?.status === 'published' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('tt.publishedHint')}
          </Typography>
        )}
        {(publish.isError || discard.isError || createFirst.isError) && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {errorMessage(publish.error ?? discard.error ?? createFirst.error, t)}
          </Alert>
        )}
      </Paper>
      {current && <VersionEditor classId={classId} version={current} />}
      {forkOpen && current && (
        <ForkDialog
          classId={classId}
          onClose={() => setForkOpen(false)}
          onCreated={async (id) => {
            await invalidate()
            setVersionId(id)
          }}
        />
      )}
    </Stack>
  )
}

function StatusTag({ v }: { v: Version }) {
  const { t } = useI18n()
  return <Tag tone={v.status === 'published' ? 'ok' : v.status === 'draft' ? 'warn' : 'neutral'} label={t(`tt.status.${v.status}`)} />
}

function VersionEditor({ classId, version }: { classId: string; version: Version }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const { days, start, end, horaire, bands, dayRanges } = useSchoolDays(classId)
  const slotsQ = slotsQuery(ctx.school.id, version.id)
  const slots = useQuery(slotsQ)
  const required = useQuery(requiredHoursQuery(ctx.school.id, classId))
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const rooms = useQuery(roomsQuery(ctx.school.id))
  const names = useQuery(membersNamesQuery(ctx.school.id))
  const assignments = useQuery(assignmentsQuery(ctx.school.id, classId))
  const teacherIds = [...new Set((assignments.data ?? []).map((a) => a.teacher_member_id))].sort()
  const busy = useQuery(teachersBusyQuery(ctx.school.id, classId, teacherIds, version.effective_from, version.effective_to))
  const [edit, setEdit] = useState<Partial<Slot> | null>(null)
  const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const [toast, setToast] = useState<{ message: string; undo?: () => Promise<unknown>; error?: boolean; n: number } | null>(null)
  const editable = version.status === 'draft'

  const subjectName = (id: string | null) => subjects.data?.find((s) => s.id === id)?.name
  const dayNames = t('setup.dayNames').split(',')
  const labels = Object.fromEntries(days.map((d) => [d, dayNames[d - 1]]))
  const list = slots.data ?? []

  const placed = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of slots.data ?? []) if (s.subject_id) m.set(s.subject_id, (m.get(s.subject_id) ?? 0) + toMin(s.ends_at) - toMin(s.starts_at))
    return m
  }, [slots.data])

  // "Ajouter une séance": the first free moment of the week, pauses skipped
  const freeFrom = (len: number, fromDay = days[0], from?: string): { weekday: number; starts_at: string } | null => {
    for (const d of days.filter((x) => x >= fromDay)) {
      const day = horaire ? dayOf(horaire, d) : { start, end, pauses: [] }
      if (!day) continue
      const taken = list.filter((s) => s.weekday === d).map((s) => ({ start: hhmm(s.starts_at), end: hhmm(s.ends_at) }))
      const at = firstFree(day, taken, len, d === fromDay && from ? from : day.start)
      if (at) return { weekday: d, starts_at: at }
    }
    return null
  }
  const nextFree = (): Partial<Slot> => ({ ...(freeFrom(15) ?? { weekday: days[0], starts_at: start }), ends_at: '' })
  const available = horaire ? weeklyTeachable(horaire) : null
  const requiredTotal = (required.data ?? []).reduce((a, r) => a + (r.weekly_minutes ?? 0), 0)

  // ------------------------------------------------ saving, optimistic + undo
  const say = (message: string, undo?: () => Promise<unknown>) => setToast({ message, undo, n: Date.now() })
  const run = async (optimistic: (s: Slot[]) => Slot[], op: () => Promise<void>) => {
    await queryClient.cancelQueries({ queryKey: slotsQ.queryKey })
    const prev = queryClient.getQueryData(slotsQ.queryKey) ?? []
    queryClient.setQueryData(slotsQ.queryKey, optimistic(prev))
    try {
      await op()
      return true
    } catch (e) {
      queryClient.setQueryData(slotsQ.queryKey, prev)
      setToast({ message: errorMessage(e, t), error: true, n: Date.now() })
      return false
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: slotsQ.queryKey }),
        queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-week'] }),
      ])
    }
  }
  type Row = Pick<Slot, 'weekday' | 'starts_at' | 'ends_at' | 'subject_id' | 'teacher_member_id' | 'room_id' | 'title'>
  const rowOf = (s: Slot): Row => ({
    weekday: s.weekday,
    starts_at: hhmm(s.starts_at),
    ends_at: hhmm(s.ends_at),
    subject_id: s.subject_id,
    teacher_member_id: s.teacher_member_id,
    room_id: s.room_id,
    title: s.title,
  })
  const update = (id: string, patch: Pick<Slot, 'weekday' | 'starts_at' | 'ends_at'>) =>
    run(
      (all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      async () => void must(await supabase.from('timetable_slots').update(patch).eq('id', id)),
    )
  const insert = async (row: Row) => {
    let id = ''
    const ok = await run(
      (all) => [...all, { ...row, id: `pending-${Date.now()}`, version_id: version.id }],
      async () => {
        id = must(
          await supabase
            .from('timetable_slots')
            .insert({ ...row, school_id: ctx.school.id, class_id: classId, version_id: version.id })
            .select('id')
            .single(),
        ).id
      },
    )
    return ok ? id : null
  }
  const remove = (id: string) =>
    run(
      (all) => all.filter((s) => s.id !== id),
      async () => void must(await supabase.from('timetable_slots').delete().eq('id', id)),
    )

  const when = (p: Place) => `${labels[p.weekday]} \u2066${p.start}–${p.end}\u2069`
  const place = async (id: string, p: Place, how: 'move' | 'resize' | 'copy') => {
    const s = list.find((x) => x.id === id)!
    const patch = { weekday: p.weekday, starts_at: p.start, ends_at: p.end }
    if (how === 'copy') {
      const nid = await insert({ ...rowOf(s), ...patch })
      if (nid) say(t('tt.duplicated', { when: when(p) }), () => remove(nid))
      return
    }
    const back = { weekday: s.weekday, starts_at: hhmm(s.starts_at), ends_at: hhmm(s.ends_at) }
    if (await update(id, patch)) say(t(how === 'move' ? 'tt.moved' : 'tt.resized', { when: when(p) }), () => update(id, back))
  }
  // Keyboard: same start and day = the length changed
  const nudge = (id: string, p: Place) => {
    const s = list.find((x) => x.id === id)!
    void place(id, p, s.weekday === p.weekday && hhmm(s.starts_at) === p.start ? 'resize' : 'move')
  }
  const del = async (id: string) => {
    const s = list.find((x) => x.id === id)
    if (!s) return
    setMenu(null)
    if (await remove(id)) say(t('tt.deleted', { name: s.title || subjectName(s.subject_id) || '' }), () => insert(rowOf(s)))
  }
  const duplicate = async (id: string) => {
    const s = list.find((x) => x.id === id)!
    setMenu(null)
    const len = toMin(s.ends_at) - toMin(s.starts_at)
    const at = freeFrom(len, s.weekday, hhmm(s.ends_at)) ?? freeFrom(len)
    if (!at) return setToast({ message: t('tt.noRoomLeft'), error: true, n: Date.now() })
    const p = { weekday: at.weekday, start: at.starts_at, end: fromMin(toMin(at.starts_at) + len) }
    const nid = await insert({ ...rowOf(s), weekday: p.weekday, starts_at: p.start, ends_at: p.end })
    if (nid) say(t('tt.duplicated', { when: when(p) }), () => remove(nid))
  }
  const teacherOf = (subjectId: string) =>
    assignments.data?.find((a) => a.subject_id === subjectId && a.kind !== 'assistant')?.teacher_member_id ?? null
  const drop = async (item: NewItem, p: Place) => {
    const nid = await insert({
      weekday: p.weekday,
      starts_at: p.start,
      ends_at: p.end,
      subject_id: item.key,
      teacher_member_id: item.teacherId,
      room_id: null,
      title: null,
    })
    if (nid) say(t('tt.created', { name: item.title, when: when(p) }), () => remove(nid))
  }

  // Ctrl/Cmd + Z undoes the last change
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || !toast?.undo) return
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return
      e.preventDefault()
      const undo = toast.undo
      setToast(null)
      void undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toast])

  // Can a session of `teacherId` sit at `p`? Pauses only warn.
  const check = (p: Place, ignoreId: string | null, teacherId: string | null): Verdict => {
    const issues = slotIssues(horaire, p.weekday, p.start, p.end)
    if (issues.closed) return { level: 'bad', message: t('tt.dayClosed') }
    if (issues.outside) return { level: 'bad', message: t('tt.outsideDay') }
    const a = toMin(p.start)
    const b = toMin(p.end)
    const hit = list.find((s) => s.id !== ignoreId && s.weekday === p.weekday && toMin(s.starts_at) < b && a < toMin(s.ends_at))
    if (hit) return { level: 'bad', message: t('tt.overlaps', { name: hit.title || subjectName(hit.subject_id) || '—' }) }
    const other = teacherId && busy.data?.find((x) => x.teacherId === teacherId && x.weekday === p.weekday && toMin(x.start) < b && a < toMin(x.end))
    if (other) return { level: 'bad', message: t('tt.teacherBusy', { name: names.data?.[teacherId!] ?? '', class: other.label }) }
    if (issues.pauses.length) return { level: 'warn', message: t('tt.overPause', { pauses: issues.pauses.map((x) => pauseLabel(x, t)).join(', ') }) }
    return { level: 'ok' }
  }

  if (slots.isPending) return <Loading rows={4} />
  if (slots.isError) return <ErrorState error={slots.error} onRetry={() => slots.refetch()} />

  const coverage = (startDrag?: (e: PointerEvent, item: NewItem) => void) => (
    <Paper variant="outlined" sx={{ p: 2, alignSelf: 'start', position: { lg: 'sticky' }, top: { lg: 16 } }}>
      <Typography variant="h5" sx={{ mb: 0.5 }}>
        {startDrag ? t('tt.toPlace') : t('tt.coverage')}
      </Typography>
      {startDrag && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('tt.toPlaceHint')}
        </Typography>
      )}
      {available !== null && requiredTotal > 0 && (
        <Alert severity={requiredTotal > available ? 'warning' : 'info'} icon={false} sx={{ mb: 1.5, py: 0 }}>
          {t('tt.availability', { program: formatMinutes(requiredTotal, locale), available: formatMinutes(available, locale) })}
        </Alert>
      )}
      {(required.data ?? []).length === 0 && <Typography color="text.secondary">{t('classes.noHours')}</Typography>}
      <Stack spacing={0.75}>
        {(required.data ?? []).map((r) => {
          const p = placed.get(r.subject_id!) ?? 0
          const need = r.weekly_minutes ?? 0
          const left = need - p
          const color = subjectColor(r.subject_id)
          const name = subjectName(r.subject_id) ?? '—'
          const done = p >= need
          const item: NewItem = {
            key: r.subject_id!,
            title: name,
            color,
            minutes: Math.max(15, Math.min(left > 0 ? left : 60, r.max_session_minutes ?? 60, 60)),
            teacherId: teacherOf(r.subject_id!),
          }
          return (
            <Box
              key={r.subject_id}
              onPointerDown={startDrag ? (e) => startDrag(e, item) : undefined}
              title={startDrag ? t('tt.dragMe') : undefined}
              sx={{
                p: 0.75,
                px: 1,
                borderRadius: '10px',
                border: `1px solid ${startDrag && !done ? `${color.ink}33` : 'transparent'}`,
                bgcolor: startDrag && !done ? color.bg : 'transparent',
                cursor: startDrag ? 'grab' : undefined,
                touchAction: startDrag ? 'none' : undefined,
                userSelect: 'none',
                '&:hover': startDrag ? { boxShadow: '0 2px 8px rgba(28,26,22,0.12)' } : undefined,
              }}
            >
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                {startDrag && <DragIndicatorOutlined sx={{ fontSize: 16, color: color.ink, opacity: 0.6 }} />}
                <Typography noWrap sx={{ fontSize: 13, fontWeight: 500, flex: 1, color: startDrag && !done ? color.ink : undefined }}>
                  {name}
                </Typography>
                <Typography sx={{ fontSize: 12, whiteSpace: 'nowrap', color: done ? tokens.accentDark : tokens.inkMuted }}>
                  {done ? `✓ ${formatMinutes(p, locale)}` : startDrag ? t('tt.left', { time: formatMinutes(left, locale) }) : `${formatMinutes(p, locale)} / ${formatMinutes(need, locale)}`}
                </Typography>
              </Stack>
              <LinearProgress variant="determinate" value={Math.min(100, (p / (need || 1)) * 100)} sx={{ height: 4, borderRadius: 3, mt: 0.5 }} />
            </Box>
          )
        })}
      </Stack>
    </Paper>
  )

  if (!editable) {
    const blocks: Block[] = list.map((s) => ({
      key: s.id,
      weekday: s.weekday,
      start: s.starts_at,
      end: s.ends_at,
      title: s.title || subjectName(s.subject_id) || '—',
      lines: [s.title ? (subjectName(s.subject_id) ?? '') : '', names.data?.[s.teacher_member_id ?? ''] ?? '', rooms.data?.find((r) => r.id === s.room_id)?.name ?? ''].filter(Boolean),
      color: subjectColor(s.subject_id),
    }))
    return (
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 300px' } }}>
        <WeekGrid days={days} dayLabels={labels} blocks={blocks} bands={bands} dayRanges={dayRanges} dayStart={start} dayEnd={end} emptyText={t('tt.emptyVersion')} />
        {coverage()}
      </Box>
    )
  }

  const plannerSlots: PlannerSlot[] = list.map((s) => ({
    id: s.id,
    weekday: s.weekday,
    start: hhmm(s.starts_at),
    end: hhmm(s.ends_at),
    title: s.title || subjectName(s.subject_id) || '—',
    lines: [s.title ? (subjectName(s.subject_id) ?? '') : '', names.data?.[s.teacher_member_id ?? ''] ?? '', rooms.data?.find((r) => r.id === s.room_id)?.name ?? ''].filter(Boolean),
    color: subjectColor(s.subject_id),
    teacherId: s.teacher_member_id,
    pending: s.id.startsWith('pending-'),
  }))
  const open = menu && list.find((s) => s.id === menu.id)

  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <Button startIcon={<AddOutlined />} variant="outlined" onClick={() => setEdit(nextFree())} sx={{ alignSelf: 'flex-start', flexShrink: 0 }}>
          {t('tt.addSlot')}
        </Button>
        <Typography variant="body2" color="text.secondary">
          {t('tt.plannerHint')}
        </Typography>
      </Stack>
      <Planner
        days={days}
        dayLabels={labels}
        slots={plannerSlots}
        bands={bands}
        busy={busy.data ?? []}
        dayRanges={dayRanges}
        dayStart={start}
        dayEnd={end}
        check={check}
        onPlace={place}
        onNudge={nudge}
        onCreate={(p) => setEdit({ weekday: p.weekday, starts_at: p.start, ends_at: p.end })}
        onOpen={(id, anchor) => setMenu({ id, anchor })}
        onDrop={drop}
        onDelete={del}
        aside={(startDrag) => coverage(startDrag)}
      />
      <Popover
        open={!!open}
        anchorEl={menu?.anchor}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
        transformOrigin={{ vertical: 'center', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 2, width: 300, borderRadius: 3 } } }}
      >
        {open && (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 12, height: 12, borderRadius: 1, bgcolor: subjectColor(open.subject_id).ink, flexShrink: 0 }} />
              <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{open.title || subjectName(open.subject_id)}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {labels[open.weekday]} · <Range start={hhmm(open.starts_at)} end={hhmm(open.ends_at)} /> · {formatMinutes(toMin(open.ends_at) - toMin(open.starts_at), locale)}
            </Typography>
            {open.title && <Typography variant="body2">{subjectName(open.subject_id)}</Typography>}
            {open.teacher_member_id && <Typography variant="body2">{names.data?.[open.teacher_member_id]}</Typography>}
            {open.room_id && <Typography variant="body2">{rooms.data?.find((r) => r.id === open.room_id)?.name}</Typography>}
            <Stack direction="row" spacing={0.5} sx={{ pt: 0.5 }}>
              <Button
                size="small"
                variant="contained"
                startIcon={<EditOutlined />}
                onClick={() => {
                  setMenu(null)
                  setEdit(open)
                }}
              >
                {t('common.edit')}
              </Button>
              <Button size="small" startIcon={<ContentCopyOutlined />} onClick={() => duplicate(open.id)}>
                {t('tt.duplicate')}
              </Button>
              <Box sx={{ flex: 1 }} />
              <IconButton size="small" color="error" aria-label={t('common.delete')} onClick={() => del(open.id)}>
                <DeleteOutlined fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>
        )}
      </Popover>
      <Snackbar
        key={toast?.n}
        open={!!toast}
        autoHideDuration={toast?.error ? 8000 : 6000}
        onClose={(_, reason) => reason !== 'clickaway' && setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast?.error ? (
          <Alert severity="error" variant="filled" onClose={() => setToast(null)}>
            {toast.message}
          </Alert>
        ) : (
          <SnackbarContent
            message={toast?.message}
            action={
              toast?.undo && (
                <Button
                  color="inherit"
                  size="small"
                  sx={{ fontWeight: 700, color: '#9FE0CF' }}
                  onClick={() => {
                    const undo = toast.undo!
                    setToast(null)
                    void undo()
                  }}
                >
                  {t('tt.undo')}
                </Button>
              )
            }
          />
        )}
      </Snackbar>
      {edit && <SlotDialog classId={classId} version={version} slot={edit} taken={list} onClose={() => setEdit(null)} />}
    </Stack>
  )
}

function SlotDialog({
  classId,
  version,
  slot,
  taken,
  onClose,
}: {
  classId: string
  version: Version
  slot: Partial<Slot>
  taken: Slot[]
  onClose: () => void
}) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const { days, horaire } = useSchoolDays(classId)
  const required = useQuery(requiredHoursQuery(ctx.school.id, classId))
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const teachers = useQuery(teachersQuery(ctx.school.id))
  const assignments = useQuery(assignmentsQuery(ctx.school.id, classId))
  const rooms = useQuery(roomsQuery(ctx.school.id))
  const [weekday, setWeekday] = useState(slot.weekday ?? 1)
  const [startsAt, setStartsAt] = useState(hhmm(slot.starts_at) || '08:30')
  const [endsAt, setEndsAt] = useState(hhmm(slot.ends_at) || '')
  const [subjectId, setSubjectId] = useState(slot.subject_id ?? '')
  const [teacherId, setTeacherId] = useState(slot.teacher_member_id ?? '')
  const [roomId, setRoomId] = useState(slot.room_id ?? '')
  const [title, setTitle] = useState(slot.title ?? '')
  const dayNames = t('setup.dayNames').split(',')

  // Choosing a subject pre-fills the teacher from "qui enseigne quoi".
  const pickSubject = (id: string) => {
    setSubjectId(id)
    const a = assignments.data?.find((x) => x.subject_id === id)
    if (a) setTeacherId(a.teacher_member_id)
    if (!endsAt) {
      const r = required.data?.find((x) => x.subject_id === id)
      let m = toMin(startsAt) + Math.min(r?.max_session_minutes ?? 60, 60)
      // stop at the next pause or session, or the end of the day
      const day = horaire ? dayOf(horaire, weekday) : null
      const limits = [
        ...(day ? [day.end, ...day.pauses.map((p) => p.start)] : []),
        ...taken.filter((s) => s.weekday === weekday && s.id !== slot.id).map((s) => hhmm(s.starts_at)),
      ]
        .map(toMin)
        .filter((x) => x > toMin(startsAt))
      if (limits.length) m = Math.min(m, ...limits)
      setEndsAt(fromMin(m))
    }
  }
  const issues = slotIssues(horaire, weekday, startsAt, endsAt)

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-slots', version.id] }),
      queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'tt-week'] }),
    ])

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        weekday,
        starts_at: startsAt,
        ends_at: endsAt,
        subject_id: subjectId || null,
        teacher_member_id: teacherId || null,
        room_id: roomId || null,
        title: title || null,
      }
      if (slot.id) must(await supabase.from('timetable_slots').update(row).eq('id', slot.id))
      else
        must(
          await supabase
            .from('timetable_slots')
            .insert({ ...row, school_id: ctx.school.id, class_id: classId, version_id: version.id }),
        )
    },
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: async () => must(await supabase.from('timetable_slots').delete().eq('id', slot.id!)),
    onSuccess: async () => {
      await invalidate()
      onClose()
    },
  })
  const classSubjects = (required.data ?? []).map((r) => r.subject_id)
  const options = (subjects.data ?? []).filter((s) => classSubjects.includes(s.id))

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <DialogTitle>{slot.id ? t('tt.editSlot') : t('tt.addSlot')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField select label={t('classes.subject')} value={subjectId} onChange={(e) => pickSubject(e.target.value)} required>
              {options.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label={t('tt.day')} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} fullWidth>
                {days.map((d) => (
                  <MenuItem key={d} value={d}>
                    {dayNames[d - 1]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                type="time"
                label={t('setup.start')}
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 300 } }}
                fullWidth
                required
              />
              <TextField
                type="time"
                label={t('setup.end')}
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 300 } }}
                fullWidth
                required
              />
            </Stack>
            <TextField select label={t('classes.teacher')} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              <MenuItem value="">—</MenuItem>
              {(teachers.data ?? []).map((x) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('tt.roomOverride')}
              helperText={t('tt.roomOverrideHint')}
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            >
              <MenuItem value="">—</MenuItem>
              {(rooms.data ?? []).map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField label={t('tt.slotTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
            {issues.closed && <Alert severity="warning">{t('tt.dayClosed')}</Alert>}
            {issues.outside && <Alert severity="warning">{t('tt.outsideDay')}</Alert>}
            {issues.pauses.length > 0 && (
              <Alert severity="warning">
                {t('tt.overPause', { pauses: issues.pauses.map((p) => `${pauseLabel(p, t)} ${p.start}–${p.end}`).join(', ') })}
              </Alert>
            )}
            {(save.isError || remove.isError) && <Alert severity="error">{errorMessage(save.error ?? remove.error, t)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          {slot.id && (
            <Button color="error" onClick={() => remove.mutate()} loading={remove.isPending} sx={{ marginInlineEnd: 'auto' }}>
              {t('common.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={save.isPending} disabled={!subjectId || !startsAt || !endsAt}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

function ForkDialog({
  classId,
  onClose,
  onCreated,
}: {
  classId: string
  onClose: () => void
  onCreated: (id: string) => void | Promise<void>
}) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const [from, setFrom] = useState(todayIso() < (ctx.year?.starts_on ?? '') ? ctx.year!.starts_on : todayIso())
  const [name, setName] = useState('')
  const fork = useMutation({
    mutationFn: async () =>
      must(
        await supabase.rpc('fork_timetable_version', {
          p_class_id: classId,
          p_from: from,
          p_name: name || t('tt.changeFrom', { date: formatDate(from, locale) }),
        }),
      ) as string,
    onSuccess: async (id) => {
      await onCreated(id)
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('tt.newVersion')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('tt.forkHint')}
          </Typography>
          <TextField type="date" label={t('tt.fromDate')} value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('tt.changeFrom', { date: formatDate(from, locale) })} />
          {fork.isError && <Alert severity="error">{errorMessage(fork.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => fork.mutate()} loading={fork.isPending}>
          {t('common.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
