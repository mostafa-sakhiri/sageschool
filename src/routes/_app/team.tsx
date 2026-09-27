import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Avatar,
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import EditOutlined from '@mui/icons-material/EditOutlined'
import PersonAddOutlined from '@mui/icons-material/PersonAddOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, Tag, initials } from '#/components/ui'
import { EmptyState, QueryState } from '#/components/states'
import { useSchool, type Role } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { InviteDialog } from '#/features/team/InviteDialog'
import { membersQuery, type MemberRow } from '#/features/team/api'
import { RoleDialog, type RoleOutcome } from '#/features/team/RoleDialog'
import { ContactDialog, type ContactTarget } from '#/features/team/ContactDialog'
import { PasswordLinkDialog, type PasswordLinkTarget } from '#/features/team/PasswordLinkDialog'
import KeyOutlined from '@mui/icons-material/KeyOutlined'
import { formatPhone } from '#/lib/format'
import { WhatsAppButton } from '#/components/WhatsApp'
import { ImportDialog } from '#/features/import/ImportZone'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import { tokens } from '#/theme/theme'


export const Route = createFileRoute('/_app/team')({
  // ?import=1 opens the Excel import (quick actions)
  validateSearch: (s: Record<string, unknown>): { import?: boolean } => ({ import: s.import === true || s.import === 1 || s.import === '1' || undefined }),
  // Loader prefetch: the list is in cache before the page renders.
  loader: ({ context }) => context.schoolId && context.queryClient.prefetchQuery(membersQuery(context.schoolId)),
  component: TeamPage,
})

const STAFF_ROLES: Role[] = ['teacher', 'staff', 'admin']

function TeamPage() {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const members = useQuery(membersQuery(ctx.school.id))
  const [open, setOpen] = useState(false)
  const [contact, setContact] = useState<ContactTarget | null>(null)
  const [passwordFor, setPasswordFor] = useState<PasswordLinkTarget | null>(null)
  const search = Route.useSearch()
  const navigateSelf = Route.useNavigate()
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState<MemberRow | null>(null)
  const [changed, setChanged] = useState<{ outcome: RoleOutcome; name: string; role: Role } | null>(null)
  useEffect(() => {
    if (!search.import) return
    setImporting(true)
    navigateSelf({ search: {}, replace: true })
  }, [search.import, navigateSelf])

  const toggle = useMutation({
    mutationFn: async (m: MemberRow) =>
      must(
        await supabase
          .from('school_members')
          .update({ status: m.status === 'active' ? 'inactive' : 'active' })
          .eq('id', m.id),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'members'] }),
  })

  return (
    <AppShell title={t('nav.team')}>
      <PageIntro
        title={t('team.title')}
        subtitle={t('team.subtitle')}
        actions={
          <>
            <Button variant="outlined" startIcon={<UploadFileOutlined />} onClick={() => setImporting(true)}>
              {t('import.button')}
            </Button>
            <Button variant="contained" startIcon={<PersonAddOutlined />} onClick={() => setOpen(true)}>
              {t('team.add')}
            </Button>
          </>
        }
      />
      <Alert severity="info" icon={false} sx={{ mb: 2 }}>
        {t('team.familiesMoved')}{' '}
        <Link to="/students" search={{ tab: 'parents' }}>
          {t('team.familiesLink')}
        </Link>
      </Alert>
      {changed && changed.outcome !== 'unchanged' && (
        <Alert severity={changed.outcome === 'added' ? 'info' : 'success'} onClose={() => setChanged(null)} sx={{ mb: 2 }}>
          {t(`team.roleChanged.${changed.outcome}`, { name: changed.name, role: t(`role.${changed.role}`) })}
        </Alert>
      )}
      {toggle.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(toggle.error, t)}</Alert>}
      <QueryState query={members} rows={5}>
        {(rows) => {
          const shown = rows.filter((m) => STAFF_ROLES.includes(m.role))
          if (shown.length === 0) return <EmptyState title={t('team.empty')} hint={t('team.emptyHint')} />
          return (
            <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('common.name')}</TableCell>
                    <TableCell>{t('auth.email')}</TableCell>
                    <TableCell>{t('common.phone')}</TableCell>
                    <TableCell>{t('team.role')}</TableCell>
                    <TableCell>{t('team.active')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shown.map((m) => (
                    <TableRow key={m.id} sx={{ opacity: m.status === 'active' ? 1 : 0.55 }}>
                      <TableCell>
                        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                          <Avatar sx={{ width: 28, height: 28, fontSize: 11, bgcolor: tokens.accentSoft, color: tokens.accentDark }}>
                            {initials(m.user?.full_name ?? '?')}
                          </Avatar>
                          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{m.user?.full_name}</Typography>
                          {m.user?.id === ctx.user.id && <Tag label={t('team.you')} />}
                        </Stack>
                      </TableCell>
                      <TableCell dir="ltr" sx={{ textAlign: 'start' }}>
                        {m.user?.email ?? '—'}
                      </TableCell>
                      <TableCell dir="ltr" sx={{ textAlign: 'start', whiteSpace: 'nowrap' }}>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <span>{formatPhone(m.user?.phone) || '—'}</span>
                          {m.user?.id !== ctx.user.id && <WhatsAppButton phone={m.user?.phone} text={t('wa.helloStaff', { name: m.user?.full_name ?? '' })} />}
                          {(ctx.isAdmin || m.user?.id === ctx.user.id) && m.user && (
                            <Tooltip title={t('contact.title')}>
                              <IconButton
                                size="small"
                                aria-label={`${t('contact.title')} — ${m.user.full_name}`}
                                onClick={() => setContact({ memberId: m.id, fullName: m.user!.full_name, phone: m.user!.phone, email: m.user!.email })}
                              >
                                <EditOutlined sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                          {ctx.isAdmin && m.user && m.user.id !== ctx.user.id && (
                            <Tooltip title={t('reset.linkAction')}>
                              <IconButton
                                size="small"
                                aria-label={`${t('reset.linkAction')} — ${m.user.full_name}`}
                                onClick={() => setPasswordFor({ memberId: m.id, fullName: m.user!.full_name, phone: m.user!.phone })}
                              >
                                <KeyOutlined sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                          <Tag tone={m.role === 'admin' ? 'ok' : m.role === 'teacher' ? 'info' : 'neutral'} label={t(`role.${m.role}`)} />
                          {STAFF_ROLES.includes(m.role) && m.user?.id !== ctx.user.id && (
                            <Tooltip title={t('team.changeRole')}>
                              <IconButton size="small" aria-label={`${t('team.changeRole')} — ${m.user?.full_name}`} onClick={() => setEditing(m)}>
                                <EditOutlined sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={m.status === 'active'}
                          disabled={m.user?.id === ctx.user.id}
                          onChange={() => toggle.mutate(m)}
                          slotProps={{ input: { 'aria-label': `${t('team.active')} — ${m.user?.full_name}` } }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )
        }}
      </QueryState>
      <Box sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('team.footnote')}
        </Typography>
      </Box>
      {contact && <ContactDialog target={contact} schoolId={ctx.school.id} onClose={() => setContact(null)} />}
      {passwordFor && <PasswordLinkDialog target={passwordFor} onClose={() => setPasswordFor(null)} />}
      {editing && (
        <RoleDialog
          member={editing}
          schoolId={ctx.school.id}
          onClose={() => setEditing(null)}
          onDone={(outcome, role) => setChanged({ outcome, role, name: editing.user?.full_name ?? '' })}
        />
      )}
      <ImportDialog open={importing} onClose={() => setImporting(false)} kinds={['teachers', 'administration']} title={t('import.staffTitle')} />
      <InviteDialog
        open={open}
        onClose={() => setOpen(false)}
        schoolId={ctx.school.id}
        roles={STAFF_ROLES}
        title={t('team.add')}
      />
    </AppShell>
  )
}
