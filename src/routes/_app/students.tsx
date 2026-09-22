import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import PersonAddOutlined from '@mui/icons-material/PersonAddOutlined'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, Tag, fullName, initials } from '#/components/ui'
import { EmptyState, QueryState } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { classesQuery } from '#/features/classes/api'
import { currentEnrollment, parentsQuery, studentsQuery, type StudentRow } from '#/features/students/api'
import { InviteDialog } from '#/features/team/InviteDialog'
import { tokens } from '#/theme/theme'

export const Route = createFileRoute('/_app/students')({
  loader: ({ context }) => context.schoolId && context.queryClient.prefetchQuery(studentsQuery(context.schoolId)),
  component: StudentsPage,
})

function StudentsPage() {
  const { t } = useI18n()
  const ctx = useSchool()
  const students = useQuery(studentsQuery(ctx.school.id))
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = students.data ?? []
    return q ? rows.filter((s) => fullName(s).toLowerCase().includes(q)) : rows
  }, [students.data, search])
  const open = (students.data ?? []).find((s) => s.id === openId) ?? null
  const unplaced = (students.data ?? []).filter((s) => s.status === 'active' && !currentEnrollment(s, ctx.year?.id)).length

  return (
    <AppShell title={t('nav.students')}>
      <PageIntro
        title={t('students.title')}
        subtitle={t('students.subtitle', { n: students.data?.length ?? 0 })}
        actions={
          <Button variant="contained" startIcon={<PersonAddOutlined />} onClick={() => setAdding(true)}>
            {t('students.add')}
          </Button>
        }
      />
      {unplaced > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('students.unplaced', { n: unplaced })}
        </Alert>
      )}
      <TextField
        placeholder={t('students.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 2, width: { xs: '100%', sm: 360 } }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlined fontSize="small" />
              </InputAdornment>
            ),
          },
          htmlInput: { 'aria-label': t('students.search') },
        }}
      />
      <QueryState
        query={students}
        rows={6}
        empty={(d) =>
          d.length === 0 ? (
            <EmptyState
              title={t('students.empty')}
              hint={t('students.emptyHint')}
              action={
                <Button variant="contained" onClick={() => setAdding(true)}>
                  {t('students.add')}
                </Button>
              }
            />
          ) : null
        }
      >
        {() => (
          <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('students.student')}</TableCell>
                  <TableCell>{t('students.class')}</TableCell>
                  <TableCell>{t('students.parents')}</TableCell>
                  <TableCell>{t('students.access')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((s) => {
                  const e = currentEnrollment(s, ctx.year?.id)
                  return (
                    <TableRow key={s.id} hover onClick={() => setOpenId(s.id)} sx={{ cursor: 'pointer' }}>
                      <TableCell>
                        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                          <Avatar sx={{ width: 28, height: 28, fontSize: 11, bgcolor: '#E7EEF7', color: '#2A4A6B' }}>
                            {initials(fullName(s))}
                          </Avatar>
                          <Button
                            variant="text"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              setOpenId(s.id)
                            }}
                            sx={{ p: 0, minHeight: 0, color: tokens.ink, fontWeight: 600 }}
                          >
                            {fullName(s)}
                          </Button>
                        </Stack>
                      </TableCell>
                      <TableCell>{e?.class?.name ?? <Tag tone="warn" label={t('students.noClass')} />}</TableCell>
                      <TableCell>
                        {s.guardians.length ? (
                          s.guardians.map((g) => g.member?.user?.full_name).join(', ')
                        ) : (
                          <Tag tone="warn" label={t('students.noParent')} />
                        )}
                      </TableCell>
                      <TableCell>{s.member_id ? <Tag tone="ok" label={t('students.hasAccess')} /> : '—'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Paper>
        )}
      </QueryState>
      <AddStudentDialog open={adding} onClose={() => setAdding(false)} onCreated={(id) => setOpenId(id)} />
      <Drawer
        anchor="right"
        open={!!open}
        onClose={() => setOpenId(null)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 }, p: 3 } } }}
      >
        {open && <StudentDetail student={open} onClose={() => setOpenId(null)} />}
      </Drawer>
    </AppShell>
  )
}

function AddStudentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [birth, setBirth] = useState('')
  const [gender, setGender] = useState('')
  const [classId, setClassId] = useState('')

  const chosen = classes.data?.find((c) => c.id === classId)
  const full = chosen?.capacity != null && (chosen.enrollments?.[0]?.count ?? 0) >= chosen.capacity

  const create = useMutation({
    mutationFn: async () => {
      const s = must(
        await supabase
          .from('students')
          .insert({
            school_id: ctx.school.id,
            first_name: first.trim(),
            last_name: last.trim(),
            birth_date: birth || null,
            gender: (gender || null) as 'female' | 'male' | null,
          })
          .select('id')
          .single(),
      )
      if (classId && ctx.year)
        must(
          await supabase.from('enrollments').insert({
            school_id: ctx.school.id,
            student_id: s.id,
            class_id: classId,
            academic_year_id: ctx.year.id,
            started_on: ctx.year.starts_on,
          }),
        )
      return s.id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      setFirst('')
      setLast('')
      setBirth('')
      setGender('')
      setClassId('')
      onClose()
      onCreated(id)
    },
  })

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <DialogTitle>{t('students.add')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label={t('students.firstName')} value={first} onChange={(e) => setFirst(e.target.value)} required fullWidth autoFocus />
              <TextField label={t('students.lastName')} value={last} onChange={(e) => setLast(e.target.value)} required fullWidth />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={t('students.birthDate')}
                type="date"
                value={birth}
                onChange={(e) => setBirth(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              <TextField select label={t('students.gender')} value={gender} onChange={(e) => setGender(e.target.value)} fullWidth>
                <MenuItem value="">—</MenuItem>
                <MenuItem value="female">{t('students.female')}</MenuItem>
                <MenuItem value="male">{t('students.male')}</MenuItem>
              </TextField>
            </Stack>
            <TextField select label={t('students.classThisYear')} value={classId} onChange={(e) => setClassId(e.target.value)}>
              <MenuItem value="">{t('students.placeLater')}</MenuItem>
              {(classes.data ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name} · {c.enrollments?.[0]?.count ?? 0}/{c.capacity ?? '∞'}
                </MenuItem>
              ))}
            </TextField>
            {full && <Alert severity="warning">{t('students.classFull')}</Alert>}
            {create.isError && <Alert severity="error">{errorMessage(create.error, t)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={create.isPending} disabled={!first.trim() || !last.trim()}>
            {t('common.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

function StudentDetail({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const parents = useQuery(parentsQuery(ctx.school.id))
  const [inviteParent, setInviteParent] = useState(false)
  const [inviteStudent, setInviteStudent] = useState(false)
  const [linkId, setLinkId] = useState<string | null>(null)
  const [relationship, setRelationship] = useState<'mother' | 'father' | 'guardian' | 'other'>('mother')
  const [isPayer, setIsPayer] = useState(true)
  const enrollment = currentEnrollment(student, ctx.year?.id)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })

  const link = useMutation({
    mutationFn: async (memberId: string) =>
      must(
        await supabase.from('student_guardians').insert({
          school_id: ctx.school.id,
          student_id: student.id,
          guardian_member_id: memberId,
          relationship,
          is_primary: student.guardians.length === 0,
          is_payer: isPayer,
        }),
      ),
    onSuccess: async () => {
      setLinkId(null)
      await invalidate()
    },
  })
  const unlink = useMutation({
    mutationFn: async (memberId: string) =>
      must(
        await supabase
          .from('student_guardians')
          .delete()
          .eq('student_id', student.id)
          .eq('guardian_member_id', memberId),
      ),
    onSuccess: invalidate,
  })
  const place = useMutation({
    mutationFn: async (classId: string) => {
      if (enrollment) must(await supabase.from('enrollments').update({ class_id: classId }).eq('id', enrollment.id))
      else
        must(
          await supabase.from('enrollments').insert({
            school_id: ctx.school.id,
            student_id: student.id,
            class_id: classId,
            academic_year_id: ctx.year!.id,
            started_on: ctx.year!.starts_on,
          }),
        )
    },
    onSuccess: invalidate,
  })
  const err = link.error ?? unlink.error ?? place.error

  // Siblings: other students sharing a guardian (spec 05: one parent, several children).
  const all = queryClient.getQueryData(studentsQuery(ctx.school.id).queryKey) ?? []
  const guardianIds = new Set(student.guardians.map((g) => g.guardian_member_id))
  const siblings = all.filter(
    (s) => s.id !== student.id && s.guardians.some((g) => guardianIds.has(g.guardian_member_id)),
  )
  const linkable = (parents.data ?? []).filter((p) => !guardianIds.has(p.id))

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h3">{fullName(student)}</Typography>
          <Typography color="text.secondary">{enrollment?.class?.name ?? t('students.noClass')}</Typography>
        </Box>
        <IconButton aria-label={t('common.close')} onClick={onClose}>
          <CloseOutlined />
        </IconButton>
      </Stack>
      {err && <Alert severity="error">{errorMessage(err, t)}</Alert>}

      <TextField
        select
        label={t('students.classThisYear')}
        value={enrollment?.class_id ?? ''}
        onChange={(e) => e.target.value && place.mutate(e.target.value)}
        disabled={!ctx.year}
      >
        {(classes.data ?? []).map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {c.name}
          </MenuItem>
        ))}
      </TextField>

      <Divider />
      <Typography variant="h5">{t('students.parents')}</Typography>
      {student.guardians.length === 0 && <Typography color="text.secondary">{t('students.noParentYet')}</Typography>}
      {student.guardians.map((g) => (
        <Stack key={g.guardian_member_id} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Avatar sx={{ width: 30, height: 30, fontSize: 11, bgcolor: '#F7E9E2', color: '#7A4423' }}>
            {initials(g.member?.user?.full_name ?? '?')}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{g.member?.user?.full_name}</Typography>
            <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted, textAlign: "start" }} dir="ltr">
              {g.member?.user?.email}
            </Typography>
          </Box>
          {g.relationship && <Tag label={t(`students.rel.${g.relationship}`)} />}
          {g.is_payer && <Tag tone="info" label={t('students.payer')} />}
          <Button size="small" color="error" onClick={() => unlink.mutate(g.guardian_member_id)}>
            {t('students.unlink')}
          </Button>
        </Stack>
      ))}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5}>
            <TextField
              select
              label={t('students.relationship')}
              value={relationship}
              onChange={(e) => setRelationship(e.target.value as typeof relationship)}
              sx={{ minWidth: 150 }}
            >
              {(['mother', 'father', 'guardian', 'other'] as const).map((r) => (
                <MenuItem key={r} value={r}>
                  {t(`students.rel.${r}`)}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={<Checkbox checked={isPayer} onChange={(e) => setIsPayer(e.target.checked)} />}
              label={t('students.payer')}
            />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Autocomplete
              options={linkable}
              value={linkable.find((p) => p.id === linkId) ?? null}
              onChange={(_, v) => setLinkId(v?.id ?? null)}
              getOptionLabel={(p) => `${p.user?.full_name ?? ''}${p.user?.email ? ` · ${p.user.email}` : ''}`}
              renderInput={(params) => <TextField {...params} label={t('students.existingParent')} />}
              sx={{ flex: 1 }}
            />
            <Button variant="outlined" disabled={!linkId} loading={link.isPending} onClick={() => linkId && link.mutate(linkId)}>
              {t('students.link')}
            </Button>
          </Stack>
          <Button variant="text" startIcon={<PersonAddOutlined />} onClick={() => setInviteParent(true)} sx={{ alignSelf: 'flex-start' }}>
            {t('students.newParent')}
          </Button>
        </Stack>
      </Paper>

      {siblings.length > 0 && (
        <>
          <Typography variant="h5">{t('students.siblings')}</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {siblings.map((s) => (
              <Tag key={s.id} tone="info" label={`${fullName(s)} · ${currentEnrollment(s, ctx.year?.id)?.class?.name ?? '—'}`} />
            ))}
          </Stack>
        </>
      )}

      <Divider />
      <Typography variant="h5">{t('students.accessTitle')}</Typography>
      {student.member_id ? (
        <Alert severity="success">{t('students.accessOn')}</Alert>
      ) : (
        <Stack spacing={1}>
          <Typography color="text.secondary" sx={{ fontSize: 14 }}>
            {t('students.accessHint')}
          </Typography>
          <Button variant="outlined" onClick={() => setInviteStudent(true)} sx={{ alignSelf: 'flex-start' }}>
            {t('students.enableAccess')}
          </Button>
        </Stack>
      )}

      <InviteDialog
        open={inviteParent}
        onClose={() => setInviteParent(false)}
        schoolId={ctx.school.id}
        roles={['parent']}
        title={t('students.newParent')}
        onCreated={(r) => link.mutateAsync(r.memberId)}
      />
      <InviteDialog
        open={inviteStudent}
        onClose={() => setInviteStudent(false)}
        schoolId={ctx.school.id}
        roles={['student']}
        studentId={student.id}
        defaultName={fullName(student)}
        title={t('students.enableAccess')}
      />
    </Stack>
  )
}
