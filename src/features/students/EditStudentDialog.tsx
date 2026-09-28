import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { todayIso } from '#/lib/format'
import type { StudentRow } from './api'

// A student's identity: name, birth date (birthdays page), gender
export function EditStudentDialog({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const [first, setFirst] = useState(student.first_name)
  const [last, setLast] = useState(student.last_name)
  const [birth, setBirth] = useState(student.birth_date ?? '')
  const [gender, setGender] = useState<string>(student.gender ?? '')
  const save = useMutation({
    mutationFn: async () =>
      must(
        await supabase
          .from('students')
          .update({
            first_name: first.trim(),
            last_name: last.trim(),
            birth_date: birth || null,
            gender: (gender || null) as 'female' | 'male' | null,
          })
          .eq('id', student.id),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'students'] })
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <DialogTitle>{t('students.edit')}</DialogTitle>
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
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIso() } }}
                fullWidth
              />
              <TextField select label={t('students.gender')} value={gender} onChange={(e) => setGender(e.target.value)} fullWidth>
                <MenuItem value="">—</MenuItem>
                <MenuItem value="female">{t('students.female')}</MenuItem>
                <MenuItem value="male">{t('students.male')}</MenuItem>
              </TextField>
            </Stack>
            {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={save.isPending} disabled={!first.trim() || !last.trim()}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
