import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import RemoveOutlined from '@mui/icons-material/RemoveOutlined'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, Tag } from '#/components/ui'
import { EmptyState, Loading, ErrorState } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import {
  formatMinutes,
  leafNodes,
  nodeLabel,
  nodeName,
  nodesQuery,
  roomsQuery,
  subjectsQuery,
  type Node,
} from '#/features/structure/api'
import {
  assignmentsQuery,
  classesQuery,
  requiredHoursQuery,
  teachersQuery,
  type ClassRow,
} from '#/features/classes/api'
import { tokens } from '#/theme/theme'

export const Route = createFileRoute('/_app/classes')({
  loader: ({ context }) =>
    context.schoolId && context.queryClient.prefetchQuery(nodesQuery(context.schoolId)),
  component: ClassesPage,
})

const LETTERS = 'ABCDEFGHIJ'

function ClassesPage() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const [selected, setSelected] = useState<string | null>(null)
  const [openClass, setOpenClass] = useState<ClassRow | null>(null)

  const leaves = useMemo(() => leafNodes(nodes.data ?? []), [nodes.data])

  if (!ctx.year)
    return (
      <AppShell title={t('nav.classes')}>
        <EmptyState title={t('year.none')} hint={t('year.noneHint')} />
      </AppShell>
    )

  const byNode = (id: string) => (classes.data ?? []).filter((c) => c.node_id === id)
  const current = leaves.find((l) => l.id === selected) ?? leaves[0]
  const total = classes.data?.length ?? 0

  return (
    <AppShell title={t('nav.classes')}>
      <PageIntro
        title={t('classes.title', { year: ctx.year.name })}
        subtitle={t('classes.subtitle', { n: total })}
      />
      {nodes.isPending || classes.isPending ? (
        <Loading rows={6} />
      ) : nodes.isError || classes.isError ? (
        <ErrorState error={nodes.error ?? classes.error} />
      ) : leaves.length === 0 ? (
        <EmptyState title={t('classes.noLevels')} />
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '300px 1fr' } }}>
          <Paper variant="outlined" sx={{ p: 1, alignSelf: 'start' }}>
            <List dense>
              {leaves.map((l) => {
                const n = byNode(l.id).length
                return (
                  <ListItemButton
                    key={l.id}
                    selected={l.id === current?.id}
                    onClick={() => setSelected(l.id)}
                    sx={{ borderRadius: 2 }}
                  >
                    <ListItemText
                      primary={nodeLabel(l, nodes.data ?? [], locale)}
                      slotProps={{ primary: { sx: { fontSize: 13.5, fontWeight: 500 } } }}
                    />
                    {n ? <Tag tone="ok" label={n} /> : <Tag tone="warn" label={t('classes.todo')} />}
                  </ListItemButton>
                )
              })}
            </List>
          </Paper>
          {current && (
            <LevelPanel
              key={current.id}
              node={current}
              nodes={nodes.data ?? []}
              classes={byNode(current.id)}
              onOpen={setOpenClass}
            />
          )}
        </Box>
      )}
      <Drawer
        anchor="right"
        open={!!openClass}
        onClose={() => setOpenClass(null)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 }, p: 3 } } }}
      >
        {openClass && <ClassDetail cls={openClass} onClose={() => setOpenClass(null)} />}
      </Drawer>
    </AppShell>
  )
}

function LevelPanel({
  node,
  nodes,
  classes,
  onOpen,
}: {
  node: Node
  nodes: Node[]
  classes: ClassRow[]
  onOpen: (c: ClassRow) => void
}) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const rooms = useQuery(roomsQuery(ctx.school.id))
  const [scheme, setScheme] = useState<'letters' | 'numbers'>('letters')
  const base = nodeName(node, 'fr')
  const nameFor = (i: number) => (scheme === 'letters' ? `${base} ${LETTERS[i]}` : `${base} ${i + 1}`)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'classes'] })

  const add = useMutation({
    mutationFn: async () => {
      const taken = new Set(classes.map((c) => c.name))
      let i = classes.length
      while (taken.has(nameFor(i))) i++
      must(
        await supabase.from('classes').insert({
          school_id: ctx.school.id,
          academic_year_id: ctx.year!.id,
          node_id: node.id,
          name: nameFor(i),
          capacity: 28,
        }),
      )
    },
    onSuccess: invalidate,
  })
  const removeLast = useMutation({
    mutationFn: async () => {
      const last = [...classes].sort((a, b) => a.name.localeCompare(b.name)).pop()
      if (last) must(await supabase.from('classes').delete().eq('id', last.id))
    },
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: async (v: { id: string; patch: Partial<Pick<ClassRow, 'name' | 'capacity' | 'home_room_id'>> }) =>
      must(await supabase.from('classes').update(v.patch).eq('id', v.id)),
    onSuccess: invalidate,
  })
  const err = add.error ?? removeLast.error ?? update.error

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
      <Typography sx={{ color: tokens.inkMuted, fontSize: 13 }}>{nodeLabel(node, nodes, locale)}</Typography>
      <Typography variant="h3" sx={{ mb: 2 }}>
        {nodeName(node, locale)}
      </Typography>
      {ctx.isAdmin && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, mb: 2.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography sx={{ fontWeight: 500 }}>{t('classes.howMany')}</Typography>
            <IconButton
              aria-label={t('classes.removeOne')}
              onClick={() => removeLast.mutate()}
              disabled={!classes.length || removeLast.isPending}
              sx={{ border: `1px solid ${tokens.lineStrong}` }}
              size="small"
            >
              <RemoveOutlined fontSize="small" />
            </IconButton>
            <Typography sx={{ fontFamily: tokens.display, fontSize: 24, minWidth: 28, textAlign: 'center' }}>
              {classes.length}
            </Typography>
            <IconButton
              aria-label={t('classes.addOne')}
              onClick={() => add.mutate()}
              disabled={add.isPending}
              sx={{ border: `1px solid ${tokens.lineStrong}` }}
              size="small"
            >
              <AddOutlined fontSize="small" />
            </IconButton>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography sx={{ fontSize: 13.5, color: tokens.inkMuted }}>{t('classes.naming')}</Typography>
            <ToggleButtonGroup size="small" exclusive value={scheme} onChange={(_, v) => v && setScheme(v)}>
              <ToggleButton value="letters">{t('classes.letters')}</ToggleButton>
              <ToggleButton value="numbers">{t('classes.numbers')}</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>
      )}
      {err && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(err, t)}</Alert>}
      {classes.length === 0 ? (
        <EmptyState title={t('classes.noneForLevel')} hint={t('classes.noneForLevelHint')} />
      ) : (
        <Stack spacing={1.25}>
          {classes.map((c) => (
            <Stack
              key={c.id}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ p: 1.5, border: `1px solid ${tokens.lineSoft}`, borderRadius: 3, alignItems: { sm: 'center' } }}
            >
              <ClassNameField cls={c} disabled={!ctx.isAdmin} onSave={(name) => update.mutate({ id: c.id, patch: { name } })} />
              <TextField
                select
                label={t('classes.capacity')}
                value={c.capacity ?? ''}
                disabled={!ctx.isAdmin}
                onChange={(e) => update.mutate({ id: c.id, patch: { capacity: e.target.value ? Number(e.target.value) : null } })}
                sx={{ width: { sm: 120 } }}
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              >
                <MenuItem value="">—</MenuItem>
                {[20, 24, 28, 32, 36].map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={t('classes.room')}
                value={c.home_room_id ?? ''}
                disabled={!ctx.isAdmin}
                onChange={(e) => update.mutate({ id: c.id, patch: { home_room_id: e.target.value || null } })}
                sx={{ width: { sm: 140 } }}
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              >
                <MenuItem value="">—</MenuItem>
                {(rooms.data ?? []).map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.name}
                  </MenuItem>
                ))}
              </TextField>
              <Typography sx={{ fontSize: 13, color: tokens.inkMuted, minWidth: 80 }}>
                {t('classes.students', { n: c.enrollments?.[0]?.count ?? 0 })}
              </Typography>
              <Button size="small" onClick={() => onOpen(c)}>
                {t('classes.subjectsTeachers')}
              </Button>
            </Stack>
          ))}
        </Stack>
      )}
    </Paper>
  )
}

function ClassNameField({ cls, disabled, onSave }: { cls: ClassRow; disabled: boolean; onSave: (n: string) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(cls.name)
  return (
    <TextField
      label={t('classes.name')}
      value={name}
      disabled={disabled}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => name.trim() && name !== cls.name && onSave(name.trim())}
      sx={{ flex: 1 }}
    />
  )
}

// "Qui enseigne quoi" for one class: the weekly hours it inherits from its
// level, and the teacher assigned to each subject.
function ClassDetail({ cls, onClose }: { cls: ClassRow; onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const hours = useQuery(requiredHoursQuery(ctx.school.id, cls.id))
  const assignments = useQuery(assignmentsQuery(ctx.school.id, cls.id))
  const subjects = useQuery(subjectsQuery(ctx.school.id))
  const teachers = useQuery(teachersQuery(ctx.school.id))

  const assign = useMutation({
    mutationFn: async (v: { subjectId: string; teacherId: string }) => {
      const existing = (assignments.data ?? []).filter((a) => a.subject_id === v.subjectId)
      if (existing.length)
        must(await supabase.from('teaching_assignments').delete().in('id', existing.map((a) => a.id)))
      if (v.teacherId)
        must(
          await supabase.from('teaching_assignments').insert({
            school_id: ctx.school.id,
            class_id: cls.id,
            subject_id: v.subjectId,
            teacher_member_id: v.teacherId,
          }),
        )
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'assignments', cls.id] }),
  })

  const subjectName = (id: string) => subjects.data?.find((s) => s.id === id)?.name ?? '—'
  const totalMin = (hours.data ?? []).reduce((s, h) => s + (h.weekly_minutes ?? 0), 0)

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h3">{cls.name}</Typography>
          <Typography color="text.secondary">
            {t('classes.weeklyTotal', { total: formatMinutes(totalMin, locale), n: hours.data?.length ?? 0 })}
          </Typography>
        </Box>
        <IconButton aria-label={t('common.close')} onClick={onClose}>
          <CloseOutlined />
        </IconButton>
      </Stack>
      {assign.isError && <Alert severity="error">{errorMessage(assign.error, t)}</Alert>}
      {hours.isPending || assignments.isPending ? (
        <Loading rows={6} />
      ) : (hours.data ?? []).length === 0 ? (
        <EmptyState title={t('classes.noHours')} hint={t('classes.noHoursHint')} />
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('classes.subject')}</TableCell>
              <TableCell>{t('hours.perWeek')}</TableCell>
              <TableCell>{t('classes.teacher')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(hours.data ?? [])
              .slice()
              .sort((a, b) => subjectName(a.subject_id!).localeCompare(subjectName(b.subject_id!)))
              .map((h) => {
                const a = assignments.data?.find((x) => x.subject_id === h.subject_id)
                return (
                  <TableRow key={h.subject_id}>
                    <TableCell sx={{ fontWeight: 500 }}>{subjectName(h.subject_id!)}</TableCell>
                    <TableCell>{formatMinutes(h.weekly_minutes ?? 0, locale)}</TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        value={a?.teacher_member_id ?? ''}
                        disabled={!ctx.isAdmin}
                        onChange={(e) => assign.mutate({ subjectId: h.subject_id!, teacherId: e.target.value })}
                        sx={{ minWidth: 190 }}
                        slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': `${t('classes.teacher')} — ${subjectName(h.subject_id!)}` } }}
                      >
                        <MenuItem value="">
                          <em>{t('classes.noTeacher')}</em>
                        </MenuItem>
                        {(teachers.data ?? []).map((tt) => (
                          <MenuItem key={tt.id} value={tt.id}>
                            {tt.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                  </TableRow>
                )
              })}
          </TableBody>
        </Table>
      )}
      {(teachers.data ?? []).length === 0 && <Alert severity="info">{t('classes.noTeachers')}</Alert>}
    </Stack>
  )
}
