import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined'
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined'
import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import LockOutlined from '@mui/icons-material/LockOutlined'
import RestartAltOutlined from '@mui/icons-material/RestartAltOutlined'
import { Card, Tag } from '#/components/ui'
import { Loading } from '#/components/states'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { PERMISSIONS, PERMISSION_GROUPS, PERMISSION_NEEDS, useSchool, type Permission } from '#/lib/session'
import { membersQuery, rolesQuery, type SchoolRole } from '#/features/team/api'
import { tokens } from '#/theme/theme'

// Only meaningful for a teacher (their own classes)
const TEACHER_ONLY: Permission[] = ['attendance.take_own', 'homework.own']
// School-wide settings: the admin's, never a permission
const ADMIN_ONLY = ['school', 'team', 'structure', 'year', 'timetable'] as const

// Turning one on brings what it needs; turning one off drops what needs it
function toggle(list: Permission[], p: Permission, on: boolean): Permission[] {
  const set = new Set(list)
  if (on) {
    const add = (x: Permission) => {
      set.add(x)
      for (const n of PERMISSION_NEEDS[x] ?? []) add(n)
    }
    add(p)
  } else {
    const drop = (x: Permission) => {
      set.delete(x)
      for (const [k, needs] of Object.entries(PERMISSION_NEEDS) as [Permission, Permission[]][]) if (needs.includes(x) && set.has(k)) drop(k)
    }
    drop(p)
  }
  return PERMISSIONS.filter((x) => set.has(x))
}

// Réglages › Rôles: the school's roles; one opened, its permissions. The
// admin has them all; the built-in secrétariat and professeur, and roles the
// school creates, are switched permission by permission.
export function RolesSection({ roleId }: { roleId?: string }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const navigate = useNavigate()
  const roles = useQuery(rolesQuery(ctx.school.id))
  const members = useQuery(membersQuery(ctx.school.id))
  const [creating, setCreating] = useState(false)

  if (roles.isPending || members.isPending) return <Loading rows={6} />
  if (roles.isError) return <Alert severity="error">{errorMessage(roles.error, t)}</Alert>
  const list = roles.data
  const active = (members.data ?? []).filter((m) => m.status === 'active')
  const count = (r: SchoolRole | 'admin') =>
    r === 'admin'
      ? active.filter((m) => m.role === 'admin').length
      : r.builtin_key
        ? active.filter((m) => m.role === r.builtin_key && !m.custom_role).length
        : active.filter((m) => m.custom_role?.id === r.id).length
  const open = (id?: string) => navigate({ to: '/setup', search: { tab: 'roles', role: id } })

  if (roleId) {
    const role = roleId === 'admin' ? 'admin' : list.find((r) => r.id === roleId)
    if (role) return <RoleDetail role={role} members={count(role)} onBack={() => open()} />
  }

  const sizeOf = (r: SchoolRole) => r.permissions.filter((p) => r.base_role === 'teacher' || !TEACHER_ONLY.includes(p)).length
  const totalOf = (r: SchoolRole) => PERMISSIONS.filter((p) => r.base_role === 'teacher' || !TEACHER_ONLY.includes(p)).length
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <Typography sx={{ flex: 1, color: tokens.inkMuted, fontSize: 14 }}>{t('roles.intro')}</Typography>
        <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreating(true)}>
          {t('access.newRole')}
        </Button>
      </Stack>
      <Paper variant="outlined">
        <RoleRow name={t('role.admin')} detail={t('roles.adminAll')} members={count('admin')} locked onClick={() => open('admin')} />
        {list.map((r) => (
          <RoleRow
            key={r.id}
            name={r.builtin_key ? t(`role.${r.builtin_key}`) : r.name!}
            detail={`${r.builtin_key ? t('access.builtIn') : t('access.basedOn', { role: t(`role.${r.base_role}`) })} · ${t('roles.count', { n: sizeOf(r), total: totalOf(r) })}`}
            members={count(r)}
            onClick={() => open(r.id)}
          />
        ))}
      </Paper>
      <Typography variant="body2" color="text.secondary">
        {t('roles.families')}
      </Typography>
      {creating && <RoleDialog role={null} onClose={() => setCreating(false)} onCreated={(id) => open(id)} />}
    </Stack>
  )
}

function RoleRow({ name, detail, members, locked, onClick }: { name: string; detail: string; members: number; locked?: boolean; onClick: () => void }) {
  const { t, dir } = useI18n()
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.5,
        textAlign: 'start',
        borderBottom: `1px solid ${tokens.lineSoft}`,
        '&:last-of-type': { borderBottom: 0 },
        '&:hover': { bgcolor: tokens.fill },
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{name}</Typography>
          {locked && <LockOutlined sx={{ fontSize: 15, color: tokens.inkMuted }} />}
        </Stack>
        <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{detail}</Typography>
      </Box>
      <Tag label={t('access.members', { n: members })} />
      <ChevronRightOutlined sx={{ color: tokens.inkMuted, transform: dir === 'rtl' ? 'scaleX(-1)' : undefined }} />
    </ButtonBase>
  )
}

function RoleDetail({ role, members, onBack }: { role: SchoolRole | 'admin'; members: number; onBack: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const admin = role === 'admin'
  const save = useMutation({
    mutationFn: async (permissions: Permission[]) =>
      must(await supabase.from('school_roles').update({ permissions }).eq('id', (role as SchoolRole).id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'roles'] })
      await queryClient.invalidateQueries({ queryKey: ['session'] })
    },
  })
  const reset = useMutation({
    mutationFn: async () => {
      const r = role as SchoolRole
      const permissions = must(await supabase.rpc('default_role_permissions', { p_key: r.builtin_key! })) as Permission[]
      must(await supabase.from('school_roles').update({ permissions }).eq('id', r.id))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'roles'] })
      await queryClient.invalidateQueries({ queryKey: ['session'] })
    },
  })
  // Shown at once; the server's answer replaces it
  const [draft, setDraft] = useState<Permission[] | null>(null)
  const granted = admin ? PERMISSIONS : (draft ?? role.permissions)
  const flip = (p: Permission, on: boolean) => {
    const next = toggle(granted, p, on)
    setDraft(next)
    save.mutate(next, { onSettled: () => setDraft(null) })
  }
  const name = admin ? t('role.admin') : role.builtin_key ? t(`role.${role.builtin_key}`) : role.name!
  const teacher = !admin && role.base_role === 'teacher'

  return (
    <Stack spacing={2}>
      <Box>
        <Button startIcon={<ArrowBackOutlined />} onClick={onBack} sx={{ mb: 1 }}>
          {t('roles.all')}
        </Button>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h3">{name}</Typography>
            <Typography sx={{ color: tokens.inkMuted, fontSize: 14 }}>
              {admin
                ? t('roles.adminAll')
                : role.builtin_key
                  ? t(`roles.builtinHint.${role.builtin_key}`)
                  : t('access.basedOn', { role: t(`role.${role.base_role}`) })}
              {' · '}
              {t('access.members', { n: members })}
            </Typography>
          </Box>
          {!admin && role.builtin_key && (
            <Button startIcon={<RestartAltOutlined />} onClick={() => reset.mutate()} loading={reset.isPending}>
              {t('roles.reset')}
            </Button>
          )}
          {!admin && !role.builtin_key && (
            <Stack direction="row" spacing={1}>
              <Button startIcon={<EditOutlined />} onClick={() => setRenaming(true)}>
                {t('access.renameRole')}
              </Button>
              <Button color="error" startIcon={<DeleteOutlined />} onClick={() => setDeleting(true)}>
                {t('common.delete')}
              </Button>
            </Stack>
          )}
        </Stack>
      </Box>
      {(save.isError || reset.isError) && <Alert severity="error">{errorMessage(save.error ?? reset.error, t)}</Alert>}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, alignItems: 'start' }}>
        {PERMISSION_GROUPS.map((g) => {
          const shown = g.permissions.filter((p) => teacher || admin || !TEACHER_ONLY.includes(p))
          if (!shown.length) return null
          return (
            <Card key={g.key}>
              <Typography variant="h5" sx={{ mb: 0.5 }}>
                {t(`perm.group.${g.key}`)}
              </Typography>
              {shown.map((p) => (
                <PermissionRow key={p} label={t(`perm.${p}`)} checked={granted.includes(p)} disabled={admin} onChange={(on) => flip(p, on)} />
              ))}
            </Card>
          )
        })}
        <Card sx={{ bgcolor: tokens.fill }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.5 }}>
            <LockOutlined sx={{ fontSize: 16, color: tokens.inkMuted }} />
            <Typography variant="h5">{t('access.group.admin')}</Typography>
          </Stack>
          {ADMIN_ONLY.map((k) => (
            <PermissionRow key={k} label={t(`access.admin.${k}`)} checked={admin} disabled onChange={() => {}} />
          ))}
        </Card>
      </Box>

      {renaming && !admin && <RoleDialog role={role} onClose={() => setRenaming(false)} />}
      {deleting && !admin && <DeleteRoleDialog role={role} members={members} onClose={() => setDeleting(false)} onDeleted={onBack} />}
    </Stack>
  )
}

function PermissionRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <FormControlLabel
      control={<Switch checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />}
      label={<Typography sx={{ fontSize: 14 }}>{label}</Typography>}
      labelPlacement="start"
      sx={{ display: 'flex', justifyContent: 'space-between', mx: 0, py: 0.25, gap: 2, borderBottom: `1px solid ${tokens.lineSoft}`, '&:last-of-type': { borderBottom: 0 } }}
    />
  )
}

// Create (name + base role) or rename. A secrétariat-based role starts from
// the built-in secrétariat's permissions, a teacher-based one from the
// professeur's; the base can't change afterwards (its members hold that role).
function RoleDialog({ role, onClose, onCreated }: { role: SchoolRole | null; onClose: () => void; onCreated?: (id: string) => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const roles = useQuery(rolesQuery(ctx.school.id))
  const [name, setName] = useState(role?.name ?? '')
  const [base, setBase] = useState<'staff' | 'teacher'>(role?.base_role ?? 'staff')
  const save = useMutation({
    mutationFn: async () => {
      if (role) {
        must(await supabase.from('school_roles').update({ name: name.trim() }).eq('id', role.id))
        return role.id
      }
      const from = roles.data?.find((r) => r.builtin_key === base)?.permissions ?? []
      const created = must(
        await supabase.from('school_roles').insert({ school_id: ctx.school.id, name: name.trim(), base_role: base, permissions: from }).select('id').single(),
      )
      return created.id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onClose()
      if (!role) onCreated?.(id)
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{role ? t('access.renameRole') : t('access.newRole')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label={t('access.roleName')} placeholder={t('access.roleNameHint')} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          {!role && (
            <Box>
              <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 0.5 }}>{t('access.base')}</Typography>
              <RadioGroup value={base} onChange={(e) => setBase(e.target.value as 'staff' | 'teacher')}>
                {(['staff', 'teacher'] as const).map((b) => (
                  <FormControlLabel
                    key={b}
                    value={b}
                    control={<Radio />}
                    sx={{ alignItems: 'flex-start', my: 0.5, '& .MuiRadio-root': { pt: 0.25 } }}
                    label={
                      <Stack>
                        <Typography sx={{ fontWeight: 600 }}>{t(`role.${b}`)}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {t(`access.baseHint.${b}`)}
                        </Typography>
                      </Stack>
                    }
                  />
                ))}
              </RadioGroup>
            </Box>
          )}
          {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim() || name.trim() === role?.name}>
          {role ? t('common.save') : t('access.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function DeleteRoleDialog({ role, members, onClose, onDeleted }: { role: SchoolRole; members: number; onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: async () => must(await supabase.from('school_roles').delete().eq('id', role.id)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onClose()
      onDeleted()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('access.deleteRole', { name: role.name! })}</DialogTitle>
      <DialogContent>
        <Typography>
          {members ? t('access.deleteHint', { n: members, role: t(`role.${role.base_role}`) }) : t('access.deleteHintEmpty')}
        </Typography>
        {remove.isError && <Alert severity="error" sx={{ mt: 1.5 }}>{errorMessage(remove.error, t)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" color="error" onClick={() => remove.mutate()} loading={remove.isPending}>
          {t('common.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
