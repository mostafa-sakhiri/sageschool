import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
} from '@mui/material'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { classesQuery } from '#/features/classes/api'

// Used by the students page and the header's quick actions.
export function AddStudentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [birth, setBirth] = useState('')
  const [gender, setGender] = useState('')
  const [classId, setClassId] = useState('')

  const chosen = classes.data?.find((c) => c.id === classId)
  const full = chosen?.capacity != null && (chosen.enrollments?.[0]?.count ?? 0) >= chosen.capacity

  const create = useMutation({
    mutationFn: async () => {
      const s = must(
        await supabase
          .from('students')
          .insert({
            school_id: ctx.school.id,
            first_name: first.trim(),
            last_name: last.trim(),
            birth_date: birth || null,
            gender: (gender || null) as 'female' | 'male' | null,
          })
          .select('id')
          .single(),
      )
      if (classId && ctx.year)
        must(
          await supabase.from('enrollments').insert({
            school_id: ctx.school.id,
            student_id: s.id,
            class_id: classId,
            academic_year_id: ctx.year.id,
            started_on: ctx.year.starts_on,
          }),
        )
      return s.id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      setFirst('')
      setLast('')
      setBirth('')
      setGender('')
      setClassId('')
      onClose()
      onCreated(id)
    },
  })

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <DialogTitle>{t('students.add')}</DialogTitle>
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
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              <TextField select label={t('students.gender')} value={gender} onChange={(e) => setGender(e.target.value)} fullWidth>
                <MenuItem value="">—</MenuItem>
                <MenuItem value="female">{t('students.female')}</MenuItem>
                <MenuItem value="male">{t('students.male')}</MenuItem>
              </TextField>
            </Stack>
            <TextField select label={t('students.classThisYear')} value={classId} onChange={(e) => setClassId(e.target.value)}>
              <MenuItem value="">{t('students.placeLater')}</MenuItem>
              {(classes.data ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name} · {c.enrollments?.[0]?.count ?? 0}/{c.capacity ?? '∞'}
                </MenuItem>
              ))}
            </TextField>
            {full && <Alert severity="warning">{t('students.classFull')}</Alert>}
            {create.isError && <Alert severity="error">{errorMessage(create.error, t)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={create.isPending} disabled={!first.trim() || !last.trim()}>
            {t('common.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
