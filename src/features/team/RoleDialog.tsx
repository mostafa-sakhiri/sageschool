import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import type { Role } from '#/lib/session'
import type { MemberRow } from './api'

const ROLES: Role[] = ['teacher', 'staff', 'admin']
export type RoleOutcome = 'replaced' | 'merged' | 'added' | 'unchanged'

// Change a staff member's role (change_member_role): a teacher who still has
// classes or sessions keeps that role and gets the new one on top.
export function RoleDialog({
  member,
  schoolId,
  onClose,
  onDone,
}: {
  member: MemberRow
  schoolId: string
  onClose: () => void
  onDone: (outcome: RoleOutcome, role: Role) => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [role, setRole] = useState<Role>(member.role)
  const save = useMutation({
    mutationFn: async () => must(await supabase.rpc('change_member_role', { p_member_id: member.id, p_role: role })) as RoleOutcome,
    onSuccess: async (outcome) => {
      await queryClient.invalidateQueries({ queryKey: ['school', schoolId] })
      onDone(outcome, role)
      onClose()
    },
  })
  const name = member.user?.full_name ?? ''

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('team.changeRoleOf', { name })}</DialogTitle>
      <DialogContent>
        <RadioGroup value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <FormControlLabel
              key={r}
              value={r}
              control={<Radio />}
              sx={{ alignItems: 'flex-start', my: 0.5, '& .MuiRadio-root': { pt: 0.25 } }}
              label={
                <Stack>
                  <Typography sx={{ fontWeight: 600 }}>
                    {t(`role.${r}`)}
                    {r === member.role && (
                      <Typography component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontSize: 13 }}>
                        {' '}
                        · {t('team.currentRole')}
                      </Typography>
                    )}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`team.roleHint.${r}`)}
                  </Typography>
                </Stack>
              }
            />
          ))}
        </RadioGroup>
        {member.role === 'teacher' && role !== 'teacher' && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            {t('team.teacherKeeps')}
          </Alert>
        )}
        {role === 'admin' && member.role !== 'admin' && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {t('team.adminWarning', { name })}
          </Alert>
        )}
        {save.isError && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {errorMessage(save.error, t)}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending} disabled={role === member.role}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
