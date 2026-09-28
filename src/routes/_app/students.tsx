import { useEffect, useMemo, useState } from 'react'
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
  Switch,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import PersonAddOutlined from '@mui/icons-material/PersonAddOutlined'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
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
import { ContactDialog, type ContactTarget } from '#/features/team/ContactDialog'
import { PasswordLinkDialog, type PasswordLinkTarget } from '#/features/team/PasswordLinkDialog'
import KeyOutlined from '@mui/icons-material/KeyOutlined'
import { formatPhone } from '#/lib/format'
import { WhatsAppButton } from '#/components/WhatsApp'
import { AddStudentDialog } from '#/features/students/AddStudentDialog'
import { ImportDialog } from '#/features/import/ImportZone'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import { subjectTokens, tokens } from '#/theme/theme'

export const Route = createFileRoute('/_app/students')({
  // ?import=1 opens the Excel import (quick actions); ?student=<id> opens a
  // student's record (links from the assistant)
  validateSearch: (s: Record<string, unknown>): { import?: boolean; tab?: 'parents'; student?: string } => ({
    import: s.import === true || s.import === 1 || s.import === '1' || undefined,
    tab: s.tab === 'parents' ? 'parents' : undefined,
    student: typeof s.student === 'string' ? s.student : undefined,
  }),
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
  const { import: openImport, tab, student: studentParam } = Route.useSearch()
  const navigateSelf = Route.useNavigate()
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    if (!openImport) return
    setImporting(true)
    navigateSelf({ search: {}, replace: true })
  }, [openImport, navigateSelf])
  useEffect(() => {
    if (!studentParam) return
    setOpenId(studentParam)
    navigateSelf({ search: {}, replace: true })
  }, [studentParam, navigateSelf])

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
          <>
            <Button variant="outlined" startIcon={<UploadFileOutlined />} onClick={() => setImporting(true)}>
              {t('import.button')}
            </Button>
            <Button variant="contained" startIcon={<PersonAddOutlined />} onClick={() => setAdding(true)}>
              {t('students.add')}
            </Button>
          </>
        }
      />
      <Tabs
        value={tab ?? 'students'}
        onChange={(_, v) => navigateSelf({ search: v === 'parents' ? { tab: 'parents' } : {} })}
        sx={{ mb: 2, borderBottom: `1px solid ${tokens.line}` }}
      >
        <Tab value="students" label={t('students.tab.students')} />
        <Tab value="parents" label={t('students.tab.parents')} />
      </Tabs>
      {tab === 'parents' ? (
        <ParentsTab onOpenStudent={setOpenId} />
      ) : (
      <>
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
                          <Avatar sx={{ width: 28, height: 28, fontSize: 11, bgcolor: subjectTokens(0).bg, color: subjectTokens(0).ink }}>
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
                          <Stack spacing={0.25}>
                            {s.guardians.map((g) => (
                              <Typography key={g.guardian_member_id} sx={{ fontSize: 13.5 }}>
                                {g.member?.user?.full_name}
                                {g.member?.user?.phone && (
                                  <Box component="span" dir="ltr" sx={{ color: tokens.inkMuted }}>
                                    {' · '}
                                    {formatPhone(g.member.user.phone)}
                                  </Box>
                                )}
                              </Typography>
                            ))}
                          </Stack>
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
      </>
      )}
      <ImportDialog open={importing} onClose={() => setImporting(false)} kinds={['students']} title={t('import.studentsTitle')} />
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

function StudentDetail({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const parents = useQuery(parentsQuery(ctx.school.id))
  const [inviteParent, setInviteParent] = useState(false)
  const [inviteStudent, setInviteStudent] = useState(false)
  const [linkId, setLinkId] = useState<string | null>(null)
  const [contact, setContact] = useState<ContactTarget | null>(null)
  const [relationship, setRelationship] = useState<'mother' | 'father' | 'guardian' | 'other'>('mother')
  const [isPayer, setIsPayer] = useState(true)
  const [deleting, setDeleting] = useState(false)
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
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          {t('students.parents')}
        </Typography>
        <Button size="small" variant="contained" startIcon={<PersonAddOutlined />} onClick={() => setInviteParent(true)}>
          {t('students.newParent')}
        </Button>
      </Stack>
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
              getOptionLabel={(p) => [p.user?.full_name, formatPhone(p.user?.phone), p.user?.email].filter(Boolean).join(' · ')}
              renderInput={(params) => <TextField {...params} label={t('students.existingParent')} />}
              sx={{ flex: 1 }}
            />
            <Button variant="outlined" disabled={!linkId} loading={link.isPending} onClick={() => linkId && link.mutate(linkId)}>
              {t('students.link')}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {student.guardians.length === 0 && <Typography color="text.secondary">{t('students.noParentYet')}</Typography>}
      {student.guardians.map((g) => (
        <Stack key={g.guardian_member_id} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Avatar sx={{ width: 30, height: 30, fontSize: 11, bgcolor: subjectTokens(1).bg, color: subjectTokens(1).ink }}>
            {initials(g.member?.user?.full_name ?? '?')}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{g.member?.user?.full_name}</Typography>
            <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted, textAlign: 'start' }} dir="ltr">
              {[formatPhone(g.member?.user?.phone), g.member?.user?.email].filter(Boolean).join(' · ') || '—'}
            </Typography>
          </Box>
          {g.relationship && <Tag label={t(`students.rel.${g.relationship}`)} />}
          {g.is_payer && <Tag tone="info" label={t('students.payer')} />}
          <WhatsAppButton phone={g.member?.user?.phone} text={t('wa.aboutChild', { name: g.member?.user?.full_name ?? '', child: student.first_name, school: ctx.school.name })} />
          {g.member?.user && (
            <IconButton
              size="small"
              aria-label={`${t('contact.title')} — ${g.member.user.full_name}`}
              onClick={() => setContact({ memberId: g.guardian_member_id, fullName: g.member!.user!.full_name, phone: g.member!.user!.phone, email: g.member!.user!.email })}
            >
              <EditOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          )}
          <Button size="small" color="error" onClick={() => unlink.mutate(g.guardian_member_id)}>
            {t('students.unlink')}
          </Button>
        </Stack>
      ))}


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
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          {t('students.accessTitle')}
        </Typography>
        {!student.member_id && (
          <Button size="small" variant="contained" onClick={() => setInviteStudent(true)}>
            {t('students.enableAccess')}
          </Button>
        )}
      </Stack>
      {student.member_id ? (
        <Alert severity="success">{t('students.accessOn')}</Alert>
      ) : (
        <Typography color="text.secondary" sx={{ fontSize: 14 }}>
          {t('students.accessHint')}
        </Typography>
      )}

      {contact && <ContactDialog target={contact} schoolId={ctx.school.id} onClose={() => setContact(null)} />}
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

      {ctx.isAdmin && (
        <>
          <Divider />
          <Box>
            <Button color="error" startIcon={<DeleteOutlined />} onClick={() => setDeleting(true)}>
              {t('students.delete')}
            </Button>
          </Box>
        </>
      )}
      {deleting && <DeleteStudentDialog student={student} onClose={() => setDeleting(false)} onDeleted={onClose} />}
    </Stack>
  )
}

// Erases the student for good (delete_student): enrollment, absences, fees and
// payments, alerts, parent links, student access. Parents' accounts stay.
// Administration only.
function DeleteStudentDialog({ student, onClose, onDeleted }: { student: StudentRow; onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: async () => must(await supabase.rpc('delete_student', { p_student_id: student.id })),
    onSuccess: async () => {
      onDeleted()
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('students.deleteTitle', { name: fullName(student) })}</DialogTitle>
      <DialogContent>
        <Alert severity="warning">{t('students.deleteWarning')}</Alert>
        {remove.isError && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(remove.error, t)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" color="error" onClick={() => remove.mutate()} loading={remove.isPending}>
          {t('students.deleteConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Parents live with the students (not in the team page): who they are, how to
// reach them, their children, whether their account is active.
function ParentsTab({ onOpenStudent }: { onOpenStudent: (id: string) => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const parents = useQuery(parentsQuery(ctx.school.id))
  const students = useQuery(studentsQuery(ctx.school.id))
  const [search, setSearch] = useState('')
  const [contact, setContact] = useState<ContactTarget | null>(null)
  const [passwordFor, setPasswordFor] = useState<PasswordLinkTarget | null>(null)
  const toggle = useMutation({
    mutationFn: async (p: { id: string; status: string }) =>
      must(await supabase.from('school_members').update({ status: p.status === 'active' ? 'inactive' : 'active' }).eq('id', p.id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] }),
  })
  const childrenOf = (memberId: string) =>
    (students.data ?? []).filter((s) => s.guardians.some((g) => g.guardian_member_id === memberId))
  const q = search.trim().toLowerCase()
  const rows = (parents.data ?? []).filter(
    (p) =>
      !q ||
      [p.user?.full_name, p.user?.email, p.user?.phone, ...childrenOf(p.id).map((c) => fullName(c))]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
  )
  return (
    <>
      <TextField
        placeholder={t('students.searchParent')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 2, width: { xs: '100%', sm: 360 } }}
        slotProps={{
          input: { startAdornment: <InputAdornment position="start"><SearchOutlined fontSize="small" /></InputAdornment> },
          htmlInput: { 'aria-label': t('students.searchParent') },
        }}
      />
      {toggle.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(toggle.error, t)}</Alert>}
      <QueryState query={parents} rows={5} empty={(d) => (d.length === 0 ? <EmptyState title={t('students.noParents')} hint={t('students.noParentsHint')} /> : null)}>
        {() => (
          <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('common.name')}</TableCell>
                  <TableCell>{t('common.phone')}</TableCell>
                  <TableCell>{t('auth.email')}</TableCell>
                  <TableCell>{t('students.children')}</TableCell>
                  {ctx.isAdmin && <TableCell>{t('team.active')}</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((p) => {
                  const kids = childrenOf(p.id)
                  return (
                    <TableRow key={p.id} sx={{ opacity: p.status === 'active' ? 1 : 0.55 }}>
                      <TableCell>
                        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                          <Avatar sx={{ width: 28, height: 28, fontSize: 11, bgcolor: subjectTokens(1).bg, color: subjectTokens(1).ink }}>
                            {initials(p.user?.full_name ?? '?')}
                          </Avatar>
                          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{p.user?.full_name}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell dir="ltr" sx={{ textAlign: 'start', whiteSpace: 'nowrap' }}>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <span>{formatPhone(p.user?.phone) || '—'}</span>
                          <WhatsAppButton phone={p.user?.phone} text={t('wa.hello', { name: p.user?.full_name ?? '', school: ctx.school.name })} />
                          {p.user && (
                            <IconButton
                              size="small"
                              aria-label={`${t('contact.title')} — ${p.user.full_name}`}
                              onClick={() => setContact({ memberId: p.id, fullName: p.user!.full_name, phone: p.user!.phone, email: p.user!.email })}
                            >
                              <EditOutlined sx={{ fontSize: 16 }} />
                            </IconButton>
                          )}
                          {p.user && (
                            <Tooltip title={t('reset.linkAction')}>
                              <IconButton
                                size="small"
                                aria-label={`${t('reset.linkAction')} — ${p.user.full_name}`}
                                onClick={() => setPasswordFor({ memberId: p.id, fullName: p.user!.full_name, phone: p.user!.phone })}
                              >
                                <KeyOutlined sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell dir="ltr" sx={{ textAlign: 'start' }}>{p.user?.email ?? '—'}</TableCell>
                      <TableCell>
                        {kids.length ? (
                          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                            {kids.map((k) => (
                              <Tag key={k.id} tone="info" label={fullName(k)} onClick={() => onOpenStudent(k.id)} />
                            ))}
                          </Stack>
                        ) : (
                          <Tag tone="warn" label={t('students.noChildLinked')} />
                        )}
                      </TableCell>
                      {ctx.isAdmin && (
                        <TableCell>
                          <Switch
                            checked={p.status === 'active'}
                            onChange={() => toggle.mutate(p)}
                            slotProps={{ input: { 'aria-label': `${t('team.active')} — ${p.user?.full_name}` } }}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Paper>
        )}
      </QueryState>
      {contact && <ContactDialog target={contact} schoolId={ctx.school.id} onClose={() => setContact(null)} />}
      {passwordFor && <PasswordLinkDialog target={passwordFor} onClose={() => setPasswordFor(null)} />}
    </>
  )
}
