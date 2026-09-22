import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { useI18n } from '#/i18n/i18n'
import { EmptyState, Loading } from '#/components/states'
import { Tag } from '#/components/ui'
import {
  formatMinutes,
  hoursQuery,
  leafNodes,
  nodeLabel,
  nodesQuery,
  resolvedHoursQuery,
  subjectsQuery,
} from '#/features/structure/api'
import { tokens } from '#/theme/theme'

// "La matière d'abord" (mockup W2): subjects on one side, every level with
// its effective weekly hours on the other. Editing a level writes an explicit
// row on that node, which overrides what it inherited.
export function HoursSection({ schoolId, yearId }: { schoolId: string; yearId: string }) {
  const { t, locale } = useI18n()
  const queryClient = useQueryClient()
  const nodes = useQuery(nodesQuery(schoolId))
  const subjects = useQuery(subjectsQuery(schoolId))
  const hours = useQuery(hoursQuery(schoolId, yearId))
  const resolved = useQuery(resolvedHoursQuery(schoolId, yearId))
  const [selected, setSelected] = useState<string | null>(null)
  const [newSubject, setNewSubject] = useState('')

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['school', schoolId, 'hours', yearId] }),
      queryClient.invalidateQueries({ queryKey: ['school', schoolId, 'resolved-hours', yearId] }),
      queryClient.invalidateQueries({ queryKey: ['school', schoolId, 'subjects'] }),
    ])

  const setMinutes = useMutation({
    mutationFn: async (v: { nodeId: string; subjectId: string; minutes: number }) =>
      must(
        await supabase.from('node_subject_hours').upsert(
          {
            school_id: schoolId,
            academic_year_id: yearId,
            node_id: v.nodeId,
            subject_id: v.subjectId,
            weekly_minutes: v.minutes,
            status: 'confirmed',
          },
          { onConflict: 'academic_year_id,node_id,subject_id' },
        ),
      ),
    onSuccess: invalidate,
  })

  const confirmAll = useMutation({
    mutationFn: async () =>
      must(
        await supabase
          .from('node_subject_hours')
          .update({ status: 'confirmed' })
          .eq('academic_year_id', yearId)
          .in('status', ['proposed', 'to_verify']),
      ),
    onSuccess: invalidate,
  })

  const addSubject = useMutation({
    mutationFn: async (name: string) =>
      must(await supabase.from('subjects').insert({ school_id: schoolId, name }).select('id').single()),
    onSuccess: async (s) => {
      setNewSubject('')
      await invalidate()
      setSelected(s.id)
    },
  })

  const leaves = useMemo(() => leafNodes(nodes.data ?? []), [nodes.data])
  const pending = (hours.data ?? []).filter((h) => h.status !== 'confirmed').length

  if (nodes.isPending || subjects.isPending || hours.isPending || resolved.isPending) return <Loading rows={5} />
  const error = nodes.error ?? subjects.error ?? hours.error ?? resolved.error
  if (error) return <Alert severity="error">{errorMessage(error, t)}</Alert>

  const subjectList = subjects.data ?? []
  const current = selected ?? subjectList[0]?.id ?? null
  const rowFor = (nodeId: string, subjectId: string) =>
    (resolved.data ?? []).find((r) => r.node_id === nodeId && r.subject_id === subjectId)
  const statusFor = (definedOn: string, subjectId: string) =>
    (hours.data ?? []).find((h) => h.node_id === definedOn && h.subject_id === subjectId)?.status
  const countFor = (subjectId: string) => leaves.filter((l) => rowFor(l.id, subjectId)).length

  return (
    <Stack spacing={2}>
      {pending > 0 && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => confirmAll.mutate()} loading={confirmAll.isPending}>
              {t('hours.confirmAll')}
            </Button>
          }
        >
          {t('hours.pending', { n: pending })}
        </Alert>
      )}
      {(setMinutes.isError || addSubject.isError) && (
        <Alert severity="error">{errorMessage(setMinutes.error ?? addSubject.error, t)}</Alert>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '280px 1fr' } }}>
        <Paper variant="outlined" sx={{ p: 1 }}>
          <Stack
            direction="row"
            spacing={1}
            component="form"
            sx={{ p: 1 }}
            onSubmit={(e) => {
              e.preventDefault()
              if (newSubject.trim()) addSubject.mutate(newSubject.trim())
            }}
          >
            <TextField
              label={t('hours.newSubject')}
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              sx={{ flex: 1 }}
            />
            <Button type="submit" variant="outlined" loading={addSubject.isPending}>
              {t('common.add')}
            </Button>
          </Stack>
          {subjectList.length === 0 && <Typography sx={{ p: 2 }}>{t('hours.noSubjects')}</Typography>}
          <List dense sx={{ maxHeight: 460, overflowY: 'auto' }}>
            {subjectList.map((s) => (
              <ListItemButton key={s.id} selected={s.id === current} onClick={() => setSelected(s.id)} sx={{ borderRadius: 2 }}>
                <ListItemText
                  primary={s.name}
                  secondary={t('hours.levelsCount', { n: countFor(s.id) })}
                  slotProps={{ primary: { sx: { fontWeight: 600 } } }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          {!current ? (
            <EmptyState title={t('hours.noSubjects')} />
          ) : (
            <Stack spacing={1}>
              <Typography variant="h4" sx={{ mb: 1 }}>
                {subjectList.find((s) => s.id === current)?.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('hours.hint')}
              </Typography>
              {leaves.map((leaf) => {
                const r = rowFor(leaf.id, current)
                const status = r ? statusFor(r.defined_on_node_id!, current) : undefined
                const inherited = r && r.defined_on_node_id !== leaf.id
                return (
                  <HoursRow
                    key={leaf.id + current}
                    label={nodeLabel(leaf, nodes.data ?? [], locale)}
                    minutes={r?.weekly_minutes ?? 0}
                    status={status}
                    inheritedFrom={
                      inherited
                        ? nodeLabel((nodes.data ?? []).find((n) => n.id === r!.defined_on_node_id)!, nodes.data ?? [], locale)
                        : undefined
                    }
                    onSave={(m) => setMinutes.mutate({ nodeId: leaf.id, subjectId: current, minutes: m })}
                  />
                )
              })}
            </Stack>
          )}
        </Paper>
      </Box>
    </Stack>
  )
}

function HoursRow({
  label,
  minutes,
  status,
  inheritedFrom,
  onSave,
}: {
  label: string
  minutes: number
  status?: string
  inheritedFrom?: string
  onSave: (m: number) => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(String(minutes / 60))
  const dirty = Number(value) * 60 !== minutes
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      sx={{
        alignItems: { sm: 'center' },
        p: 1.25,
        borderRadius: 2,
        border: `1px solid ${tokens.lineSoft}`,
        bgcolor: minutes ? '#fff' : tokens.paper,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 500, fontSize: 14 }}>{label}</Typography>
        {inheritedFrom && (
          <Typography sx={{ fontSize: 12, color: tokens.inkMuted }}>{t('hours.inherited', { node: inheritedFrom })}</Typography>
        )}
      </Box>
      {status === 'proposed' && <Tag tone="info" label={t('hours.status.proposed')} />}
      {status === 'to_verify' && <Tag tone="warn" label={t('hours.status.to_verify')} />}
      {status === 'confirmed' && <Tag tone="ok" label={t('hours.status.confirmed')} />}
      {!minutes && <Tag label={t('hours.notTaught')} />}
      <TextField
        type="number"
        label={t('hours.perWeek')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        slotProps={{ htmlInput: { min: 0, step: 0.5, 'aria-label': `${label} — ${t('hours.perWeek')}` } }}
        sx={{ width: 120 }}
        helperText={formatMinutes(Math.round(Number(value || 0) * 60))}
      />
      <Button
        size="small"
        variant={dirty ? 'contained' : 'text'}
        disabled={!dirty || Number(value) < 0}
        onClick={() => onSave(Math.round(Number(value) * 60))}
      >
        {t('common.save')}
      </Button>
    </Stack>
  )
}
