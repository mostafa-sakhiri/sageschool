import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { STAFF_ROLES, staffRoleOf, type StaffRole } from '#/lib/session'
import { rolesQuery, type MemberRow } from './api'

export type RoleOutcome = 'replaced' | 'merged' | 'added' | 'unchanged'

// Change a staff member's role (change_member_role): a teacher who still has
// classes or sessions keeps that role and gets the new one on top. A role
// created by the school is its base role plus custom_role_id on the
// membership of that base role.
export function RoleDialog({
  member,
  schoolId,
  onClose,
  onDone,
}: {
  member: MemberRow
  schoolId: string
  onClose: () => void
  // `roleLabel`: the role's name as shown (a created role has its own)
  onDone: (outcome: RoleOutcome, roleLabel: string) => void
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const all = useQuery(rolesQuery(schoolId))
  // Only roles created by the school are listed here; built-in ones are the radios above
  const roles = { data: all.data?.filter((r) => !r.builtin_key) }
  const current = member.custom_role ? `custom:${member.custom_role.id}` : staffRoleOf(member)
  const [choice, setChoice] = useState<string>(current)
  const custom = roles.data?.find((r) => `custom:${r.id}` === choice)
  // The built-in role underneath (a custom role's base)
  const role: StaffRole = custom ? custom.base_role : (choice as StaffRole)
  const save = useMutation({
    mutationFn: async () => {
      // A created role keeps the member's role when it's built on it (an
      // assistant stays one under a teacher-based role)
      const same = custom ? member.role === custom.base_role : role === staffRoleOf(member)
      const outcome =
        same ? 'unchanged' : (must(await supabase.rpc('change_member_role', { p_member_id: member.id, p_role: role })) as RoleOutcome)
      // The membership that now holds the base role (a teacher who keeps
      // their classes gets a second membership)
      const target = must(
        await supabase
          .from('school_members')
          .select('id')
          .eq('school_id', schoolId)
          .eq('user_id', member.user!.id)
          .eq('role', custom ? custom.base_role : role === 'assistant' ? 'teacher' : role)
          .single(),
      )
      must(await supabase.from('school_members').update({ custom_role_id: custom?.id ?? null }).eq('id', target.id))
      return outcome === 'unchanged' && choice !== current ? 'replaced' : outcome
    },
    onSuccess: async (outcome) => {
      await queryClient.invalidateQueries({ queryKey: ['school', schoolId] })
      onDone(outcome, custom ? custom.name! : t(`role.${role}`))
      onClose()
    },
  })
  const name = member.user?.full_name ?? ''

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('team.changeRoleOf', { name })}</DialogTitle>
      <DialogContent>
        <RadioGroup value={choice} onChange={(e) => setChoice(e.target.value)}>
          {STAFF_ROLES.map((r) => (
            <FormControlLabel
              key={r}
              value={r}
              control={<Radio />}
              // An administrator must have an e-mail (it's how a forgotten password comes back)
              disabled={r === 'admin' && member.role !== 'admin' && !member.user?.email}
              sx={{ alignItems: 'flex-start', my: 0.5, '& .MuiRadio-root': { pt: 0.25 } }}
              label={
                <Stack>
                  <Typography sx={{ fontWeight: 600 }}>
                    {t(`role.${r}`)}
                    {r === current && (
                      <Typography component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontSize: 13 }}>
                        {' '}
                        · {t('team.currentRole')}
                      </Typography>
                    )}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {r === 'admin' && member.role !== 'admin' && !member.user?.email ? t('team.adminNeedsEmail') : t(`team.roleHint.${r}`)}
                  </Typography>
                </Stack>
              }
            />
          ))}
          {!!roles.data?.length && <Divider sx={{ my: 1 }}>{t('access.schoolRoles')}</Divider>}
          {(roles.data ?? []).map((r) => (
            <FormControlLabel
              key={r.id}
              value={`custom:${r.id}`}
              control={<Radio />}
              sx={{ alignItems: 'flex-start', my: 0.5, '& .MuiRadio-root': { pt: 0.25 } }}
              label={
                <Stack>
                  <Typography sx={{ fontWeight: 600 }}>
                    {r.name}
                    {`custom:${r.id}` === current && (
                      <Typography component="span" sx={{ fontWeight: 400, color: 'text.secondary', fontSize: 13 }}>
                        {' '}
                        · {t('team.currentRole')}
                      </Typography>
                    )}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('access.basedOn', { role: t(`role.${r.base_role}`) })}
                  </Typography>
                </Stack>
              }
            />
          ))}
        </RadioGroup>
        {member.role === 'teacher' && role !== 'teacher' && role !== 'assistant' && (
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
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending} disabled={choice === current}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
