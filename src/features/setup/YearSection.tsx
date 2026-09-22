import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { useI18n } from '#/i18n/i18n'
import { QueryState, EmptyState } from '#/components/states'
import { Tag } from '#/components/ui'
import { TEMPLATE, yearsQuery } from '#/features/structure/api'
import { formatDate } from '#/lib/format'

// Default: the Moroccan school year containing today (Sept -> June).
function defaultYear() {
  const now = new Date()
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1
  return { name: `${y}-${y + 1}`, starts_on: `${y}-09-07`, ends_on: `${y + 1}-06-30` }
}

export function useCreateYear(schoolId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { name: string; starts_on: string; ends_on: string; current: boolean; applyHours: boolean }) => {
      const year = must(
        await supabase
          .from('academic_years')
          .insert({ school_id: schoolId, name: v.name, starts_on: v.starts_on, ends_on: v.ends_on })
          .select('id')
          .single(),
      )
      if (v.current) must(await supabase.rpc('set_current_academic_year', { p_year_id: year.id }))
      let hours = 0
      if (v.applyHours) {
        hours = must(
          await supabase.rpc('apply_curriculum_template_hours', {
            p_school_id: schoolId,
            p_academic_year_id: year.id,
            p_template_code: TEMPLATE,
          }),
        ) as number
      }
      return { yearId: year.id, hours }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', schoolId] }),
  })
}

export function YearForm({
  schoolId,
  onDone,
  submitLabel,
}: {
  schoolId: string
  onDone?: (r: { yearId: string; hours: number }) => void
  submitLabel?: string
}) {
  const { t } = useI18n()
  const d = defaultYear()
  const [name, setName] = useState(d.name)
  const [start, setStart] = useState(d.starts_on)
  const [end, setEnd] = useState(d.ends_on)
  const [current, setCurrent] = useState(true)
  const [applyHours, setApplyHours] = useState(true)
  const create = useCreateYear(schoolId)

  return (
    <Stack
      component="form"
      spacing={2}
      onSubmit={(e) => {
        e.preventDefault()
        create.mutate({ name, starts_on: start, ends_on: end, current, applyHours }, { onSuccess: onDone })
      }}
    >
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' } }}>
        <TextField label={t('year.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <TextField
          label={t('year.start')}
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          required
        />
        <TextField
          label={t('year.end')}
          type="date"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          required
        />
      </Box>
      <FormControlLabel
        control={<Checkbox checked={current} onChange={(e) => setCurrent(e.target.checked)} />}
        label={t('year.makeCurrent')}
      />
      <FormControlLabel
        control={<Checkbox checked={applyHours} onChange={(e) => setApplyHours(e.target.checked)} />}
        label={t('year.applyHours')}
      />
      {create.isError && <Alert severity="error">{errorMessage(create.error, t)}</Alert>}
      <Box>
        <Button type="submit" variant="contained" loading={create.isPending} disabled={!name || !start || !end}>
          {submitLabel ?? t('year.create')}
        </Button>
      </Box>
    </Stack>
  )
}

export function YearSection({ schoolId }: { schoolId: string }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const years = useQuery(yearsQuery(schoolId))
  const [adding, setAdding] = useState(false)
  const makeCurrent = useMutation({
    mutationFn: async (id: string) => must(await supabase.rpc('set_current_academic_year', { p_year_id: id })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', schoolId] }),
  })

  return (
    <Stack spacing={2}>
      <QueryState
        query={years}
        empty={(d) => (d.length === 0 ? <EmptyState title={t('year.none')} hint={t('year.noneHint')} /> : null)}
      >
        {(rows) => (
          <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('year.name')}</TableCell>
                  <TableCell>{t('year.start')}</TableCell>
                  <TableCell>{t('year.end')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((y) => (
                  <TableRow key={y.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{y.name}</TableCell>
                    <TableCell>{formatDate(y.starts_on, locale)}</TableCell>
                    <TableCell>{formatDate(y.ends_on, locale)}</TableCell>
                    <TableCell>{y.is_current ? <Tag tone="ok" label={t('year.current')} /> : '—'}</TableCell>
                    <TableCell align="right">
                      {!y.is_current && (
                        <Button size="small" onClick={() => makeCurrent.mutate(y.id)} loading={makeCurrent.isPending}>
                          {t('year.setCurrent')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </QueryState>
      {makeCurrent.isError && <Alert severity="error">{errorMessage(makeCurrent.error, t)}</Alert>}
      {adding ? (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('year.new')}
          </Typography>
          <YearForm schoolId={schoolId} onDone={() => setAdding(false)} />
        </Paper>
      ) : (
        <Box>
          <Button variant="outlined" onClick={() => setAdding(true)}>
            {t('year.new')}
          </Button>
        </Box>
      )}
    </Stack>
  )
}
