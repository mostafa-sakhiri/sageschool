import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Button,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
} from '@mui/material'
import DeleteOutline from '@mui/icons-material/DeleteOutlined'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { useI18n } from '#/i18n/i18n'
import { QueryState, EmptyState } from '#/components/states'
import { roomsQuery, subjectsQuery } from '#/features/structure/api'

// Flat list (mockup W3): free name, capacity, and an optional subject that
// "owns" the room (sport -> gymnase). The subject's room wins over the class's.
export function RoomsSection({ schoolId }: { schoolId: string }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const rooms = useQuery(roomsQuery(schoolId))
  const subjects = useQuery(subjectsQuery(schoolId))
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('')
  const [subjectId, setSubjectId] = useState('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['school', schoolId] })

  const add = useMutation({
    mutationFn: async () => {
      const room = must(
        await supabase
          .from('rooms')
          .insert({ school_id: schoolId, name: name.trim(), capacity: capacity ? Number(capacity) : null })
          .select('id')
          .single(),
      )
      if (subjectId) must(await supabase.from('subjects').update({ room_id: room.id }).eq('id', subjectId))
    },
    onSuccess: async () => {
      setName('')
      setCapacity('')
      setSubjectId('')
      await invalidate()
    },
  })
  const remove = useMutation({
    mutationFn: async (id: string) => must(await supabase.from('rooms').delete().eq('id', id)),
    onSuccess: invalidate,
  })

  const subjectOf = (roomId: string) => (subjects.data ?? []).filter((s) => s.room_id === roomId).map((s) => s.name)

  return (
    <Stack spacing={2}>
      <QueryState
        query={rooms}
        empty={(d) => (d.length === 0 ? <EmptyState title={t('rooms.none')} hint={t('rooms.noneHint')} /> : null)}
      >
        {(rows) => (
          <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('common.name')}</TableCell>
                  <TableCell>{t('rooms.capacity')}</TableCell>
                  <TableCell>{t('rooms.usage')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
                    <TableCell>{r.capacity ?? '—'}</TableCell>
                    <TableCell>{subjectOf(r.id).join(', ') || t('rooms.study')}</TableCell>
                    <TableCell align="right">
                      <IconButton aria-label={`${t('common.delete')} ${r.name}`} onClick={() => remove.mutate(r.id)} size="small">
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </QueryState>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          component="form"
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          onSubmit={(e) => {
            e.preventDefault()
            add.mutate()
          }}
        >
          <TextField label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} required sx={{ flex: 1 }} />
          <TextField
            label={t('rooms.capacity')}
            type="number"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            sx={{ width: { sm: 120 } }}
          />
          <TextField
            select
            label={t('rooms.usage')}
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">{t('rooms.study')}</MenuItem>
            {(subjects.data ?? []).map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {t('rooms.reservedFor', { subject: s.name })}
              </MenuItem>
            ))}
          </TextField>
          <Button type="submit" variant="contained" disabled={!name.trim()} loading={add.isPending}>
            {t('common.add')}
          </Button>
        </Stack>
      </Paper>
      {(add.isError || remove.isError) && <Alert severity="error">{errorMessage(add.error ?? remove.error, t)}</Alert>}
    </Stack>
  )
}
