import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import PersonAddOutlined from '@mui/icons-material/PersonAddOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, Tag, initials } from '#/components/ui'
import { EmptyState, QueryState } from '#/components/states'
import { useSchool, type Role } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { InviteDialog } from '#/features/team/InviteDialog'
import { tokens } from '#/theme/theme'

export type MemberRow = {
  id: string
  role: Role
  status: 'active' | 'inactive'
  user: { id: string; full_name: string; email: string | null; phone: string | null } | null
}

export const membersQuery = (schoolId: string) =>
  queryOptions({
    queryKey: ['school', schoolId, 'members'],
    queryFn: async () =>
      must(
        await supabase
          .from('school_members')
          .select('id, role, status, user:users(id, full_name, email, phone)')
          .eq('school_id', schoolId)
          .order('created_at'),
      ) as unknown as MemberRow[],
  })

export const Route = createFileRoute('/_app/team')({
  // Loader prefetch: the list is in cache before the page renders.
  loader: ({ context }) => context.schoolId && context.queryClient.prefetchQuery(membersQuery(context.schoolId)),
  component: TeamPage,
})

const STAFF_ROLES: Role[] = ['teacher', 'staff', 'admin']
const TABS = ['staff', 'families'] as const

function TeamPage() {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const members = useQuery(membersQuery(ctx.school.id))
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<(typeof TABS)[number]>('staff')

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
          <Button variant="contained" startIcon={<PersonAddOutlined />} onClick={() => setOpen(true)}>
            {t('team.add')}
          </Button>
        }
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: `1px solid ${tokens.line}` }}>
        <Tab value="staff" label={t('team.tab.staff')} />
        <Tab value="families" label={t('team.tab.families')} />
      </Tabs>
      {toggle.isError && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage(toggle.error, t)}</Alert>}
      <QueryState query={members} rows={5}>
        {(rows) => {
          const shown = rows.filter((m) =>
            tab === 'staff' ? STAFF_ROLES.includes(m.role) : m.role === 'parent' || m.role === 'student',
          )
          if (shown.length === 0)
            return <EmptyState title={t('team.empty')} hint={tab === 'staff' ? t('team.emptyHint') : t('team.familiesHint')} />
          return (
            <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('common.name')}</TableCell>
                    <TableCell>{t('auth.email')}</TableCell>
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
                      <TableCell>
                        <Tag tone={m.role === 'admin' ? 'ok' : m.role === 'teacher' ? 'info' : 'neutral'} label={t(`role.${m.role}`)} />
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
