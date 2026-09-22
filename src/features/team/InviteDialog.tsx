import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { inviteMember } from '#/lib/members'
import { useI18n } from '#/i18n/i18n'
import { errorMessage } from '#/lib/errors'
import type { Role } from '#/lib/session'
import { tokens } from '#/theme/theme'

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
  onCreated,
}: {
  open: boolean
  onClose: () => void
  schoolId: string
  roles: Role[]
  title: string
  studentId?: string
  defaultName?: string
  onCreated?: (r: InviteResult) => void | Promise<void>
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState(defaultName)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>(roles[0])
  const [password, setPassword] = useState('')
  const [result, setResult] = useState<InviteResult | null>(null)

  const invite = useMutation({
    mutationFn: () => inviteMember({ data: { schoolId, email, fullName, role, password: password || undefined, studentId } }),
    onSuccess: async (r) => {
      await onCreated?.(r)
      await queryClient.invalidateQueries({ queryKey: ['school', schoolId] })
      setResult(r)
    },
  })

  const close = () => {
    setResult(null)
    setEmail('')
    setPassword('')
    setFullName(defaultName)
    invite.reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      {result ? (
        <>
          <DialogContent>
            <Alert severity="success" sx={{ mb: 2 }}>
              {t('team.created', { name: fullName })}
            </Alert>
            {result.password ? (
              <Stack spacing={1}>
                <Typography>{t('team.handOver')}</Typography>
                <Typography
                  dir="ltr"
                  sx={{ fontFamily: 'IBM Plex Mono, monospace', p: 1.5, bgcolor: tokens.paper, borderRadius: 2 }}
                >
                  {email} · {result.password}
                </Typography>
              </Stack>
            ) : (
              <Typography>{t('team.existingAccount')}</Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={close}>
              {t('common.close')}
            </Button>
          </DialogActions>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            invite.mutate()
          }}
        >
          <DialogContent>
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
          </DialogContent>
          <DialogActions>
            <Button onClick={close}>{t('common.cancel')}</Button>
            <Button type="submit" variant="contained" loading={invite.isPending} disabled={!fullName.trim() || !email}>
              {t('common.create')}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  )
}
