import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { inviteMember } from '#/lib/members'
import { useI18n } from '#/i18n/i18n'
import { errorMessage } from '#/lib/errors'
import { normalizePhone } from '#/lib/format'
import type { Role } from '#/lib/session'
import { tokens } from '#/theme/theme'
import { SurfaceActions, SurfaceContent, SurfaceDialog, SurfaceTitle } from '#/components/Surface'

export type InviteResult = { memberId: string; userId: string; password: string | null }

// Shared by the team page (staff roles), the students page (parents) and the
// student-access action. `roles` limits what can be picked.
export function InviteDialog({
  open,
  onClose,
  schoolId,
  roles,
  title,
  studentId,
  defaultName = '',
  defaultEmail = '',
  defaultPhone = '',
  defaultRole,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  schoolId: string
  roles: Role[]
  title: string
  studentId?: string
  defaultName?: string
  defaultEmail?: string
  defaultPhone?: string
  defaultRole?: Role
  onCreated?: (r: InviteResult) => void | Promise<void>
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState(defaultName)
  const [email, setEmail] = useState(defaultEmail)
  const [phone, setPhone] = useState(defaultPhone)
  const [role, setRole] = useState<Role>(defaultRole && roles.includes(defaultRole) ? defaultRole : roles[0])
  const [password, setPassword] = useState('')
  const [result, setResult] = useState<InviteResult | null>(null)

  const invite = useMutation({
    mutationFn: () => inviteMember({ data: { schoolId, email, fullName, phone: normalizePhone(phone), role, password: password || undefined, studentId } }),
    onSuccess: async (r) => {
      await onCreated?.(r)
      await queryClient.invalidateQueries({ queryKey: ['school', schoolId] })
      setResult(r)
    },
  })

  const close = () => {
    setResult(null)
    setEmail('')
    setPhone('')
    setPassword('')
    setFullName(defaultName)
    invite.reset()
    onClose()
  }

  return (
    <SurfaceDialog open={open} onClose={close} fullWidth maxWidth="sm">
      <SurfaceTitle>{title}</SurfaceTitle>
      {result ? (
        <>
          <SurfaceContent>
            <Alert severity="success" sx={{ mb: 2 }}>
              {t('team.created', { name: fullName })}
            </Alert>
            {result.password ? (
              <Stack spacing={1}>
                <Typography>{t('team.handOver')}</Typography>
                <Typography
                  dir="ltr"
                  sx={{ fontFamily: 'IBM Plex Mono, monospace', p: 1.5, bgcolor: tokens.fill, borderRadius: 2 }}
                >
                  {email} · {result.password}
                </Typography>
              </Stack>
            ) : (
              <Typography>{t('team.existingAccount')}</Typography>
            )}
          </SurfaceContent>
          <SurfaceActions>
            <Button variant="contained" onClick={close}>
              {t('common.close')}
            </Button>
          </SurfaceActions>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            invite.mutate()
          }}
        >
          <SurfaceContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField label={t('auth.fullName')} value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
              <TextField
                label={t('auth.email')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                slotProps={{ htmlInput: { dir: 'ltr' } }}
              />
              <TextField
                label={t('common.phone')}
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="06 12 34 56 78"
                slotProps={{ htmlInput: { dir: 'ltr' } }}
              />
              {roles.length > 1 && (
                <TextField select label={t('team.role')} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {roles.map((r) => (
                    <MenuItem key={r} value={r}>
                      {t(`role.${r}`)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                label={t('team.password')}
                helperText={t('team.passwordHint')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                slotProps={{ htmlInput: { dir: 'ltr', minLength: 6 } }}
              />
              {invite.isError && <Alert severity="error">{errorMessage(invite.error, t)}</Alert>}
            </Stack>
          </SurfaceContent>
          <SurfaceActions>
            <Button onClick={close}>{t('common.cancel')}</Button>
            <Button type="submit" variant="contained" loading={invite.isPending} disabled={!fullName.trim() || !email}>
              {t('common.create')}
            </Button>
          </SurfaceActions>
        </form>
      )}
    </SurfaceDialog>
  )
}
