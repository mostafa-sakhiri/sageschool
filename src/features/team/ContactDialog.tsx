import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { normalizePhone } from '#/lib/format'

export type ContactTarget = { memberId: string; fullName: string; phone: string | null; email: string | null }

// Name and phone of a member (staff, parent, oneself), through the
// update_member_contact RPC: admin -> anyone, secrétariat -> families, anyone -> self.
export function ContactDialog({ target, schoolId, onClose }: { target: ContactTarget; schoolId: string; onClose: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState(target.fullName)
  const [phone, setPhone] = useState(target.phone ?? '')
  const save = useMutation({
    mutationFn: async () =>
      must(await supabase.rpc('update_member_contact', { p_member_id: target.memberId, p_full_name: fullName.trim(), p_phone: normalizePhone(phone) })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', schoolId] })
      await queryClient.invalidateQueries({ queryKey: ['session'] })
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <DialogTitle>{t('contact.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label={t('auth.fullName')} value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
            <TextField
              label={t('common.phone')}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="06 12 34 56 78"
              helperText={t('contact.phoneHint')}
              slotProps={{ htmlInput: { dir: 'ltr' } }}
            />
            {target.email && (
              <Typography variant="body2" color="text.secondary" dir="ltr" sx={{ textAlign: 'start' }}>
                {target.email}
              </Typography>
            )}
            {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={save.isPending} disabled={!fullName.trim()}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
