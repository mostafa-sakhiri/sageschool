import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputBase,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined'
import LayersOutlined from '@mui/icons-material/LayersOutlined'
import MeetingRoomOutlined from '@mui/icons-material/MeetingRoomOutlined'
import EditOutlined from '@mui/icons-material/EditOutlined'
import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
import PlaylistAddOutlined from '@mui/icons-material/PlaylistAddOutlined'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { useI18n } from '#/i18n/i18n'
import { Loading } from '#/components/states'
import { Tag } from '#/components/ui'
import { roomAreasQuery, roomsQuery, subjectsQuery, type RoomArea } from '#/features/structure/api'
import { tokens } from '#/theme/theme'

type Room = { id: string; name: string; capacity: number | null; area_id: string | null }
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true })

// Rooms, grouped only as much as the school needs: a plain list for one
// corridor; buildings, floors, or buildings with floors otherwise. A room is
// added by typing its name where it is; several at once ("Salle 1 à 12");
// a click on a room edits or moves it. A subject can own a room (sport ->
// gymnase): the subject's room wins over the class's.
export function RoomsSection({ schoolId }: { schoolId: string }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const rooms = useQuery(roomsQuery(schoolId))
  const areas = useQuery(roomAreasQuery(schoolId))
  const subjects = useQuery(subjectsQuery(schoolId))
  const [naming, setNaming] = useState<{ kind: 'building' | 'floor'; parent: string | null; area?: RoomArea } | null>(null)
  const [deletingArea, setDeletingArea] = useState<RoomArea | null>(null)
  const [editing, setEditing] = useState<Room | null>(null)
  const [bulk, setBulk] = useState<string | null | undefined>(undefined)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['school', schoolId] })
  const addRoom = useMutation({
    mutationFn: async ({ name, area }: { name: string; area: string | null }) =>
      must(await supabase.from('rooms').insert({ school_id: schoolId, name: name.trim(), area_id: area })),
    onSuccess: invalidate,
  })
  const saveArea = useMutation({
    mutationFn: async ({ name, kind, parent, area }: { name: string; kind: 'building' | 'floor'; parent: string | null; area?: RoomArea }) => {
      if (area) return must(await supabase.from('room_areas').update({ name: name.trim() }).eq('id', area.id))
      const siblings = (areas.data ?? []).filter((a) => a.parent_id === parent && a.kind === kind)
      must(
        await supabase
          .from('room_areas')
          .insert({ school_id: schoolId, kind, parent_id: parent, name: name.trim(), position: siblings.length }),
      )
    },
    onSuccess: async () => {
      setNaming(null)
      await invalidate()
    },
  })
  const removeArea = useMutation({
    mutationFn: async (id: string) => must(await supabase.from('room_areas').delete().eq('id', id)),
    onSuccess: async () => {
      setDeletingArea(null)
      await invalidate()
    },
  })

  if (rooms.isPending || areas.isPending) return <Loading rows={4} />
  const all = (rooms.data ?? []) as Room[]
  const list = areas.data ?? []
  const buildings = list.filter((a) => a.kind === 'building')
  const looseFloors = list.filter((a) => a.kind === 'floor' && !a.parent_id)
  const floorsOf = (b: string) => list.filter((a) => a.parent_id === b)
  const roomsIn = (area: string | null) => all.filter((r) => r.area_id === area).sort(byName)
  const reservedFor = (roomId: string) => (subjects.data ?? []).filter((s) => s.room_id === roomId).map((s) => s.name)
  const nextFloor = (parent: string | null) => {
    const n = list.filter((a) => a.kind === 'floor' && a.parent_id === parent).length
    return n === 0 ? t('rooms.groundFloor') : t('rooms.floorN', { n })
  }
  const error = addRoom.error ?? saveArea.error ?? removeArea.error

  const place = (area: string | null, title?: React.ReactNode) => (
    <Place
      key={area ?? 'none'}
      title={title}
      rooms={roomsIn(area)}
      reservedFor={reservedFor}
      onAdd={(name) => addRoom.mutateAsync({ name, area })}
      onOpen={setEditing}
      onBulk={() => setBulk(area)}
    />
  )

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <Typography sx={{ flex: 1, color: tokens.inkMuted, fontSize: 14 }}>{t(list.length ? 'rooms.introGrouped' : 'rooms.intro')}</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<ApartmentOutlined />} onClick={() => setNaming({ kind: 'building', parent: null })}>
            {t('rooms.addBuilding')}
          </Button>
          {buildings.length === 0 && (
            <Button variant="outlined" startIcon={<LayersOutlined />} onClick={() => setNaming({ kind: 'floor', parent: null })}>
              {t('rooms.addFloor')}
            </Button>
          )}
        </Stack>
      </Stack>
      {error && <Alert severity="error">{errorMessage(error, t)}</Alert>}

      {/* Rooms without a place: the whole list when nothing is grouped */}
      {(list.length === 0 || roomsIn(null).length > 0) && place(null, list.length ? t('rooms.unplaced') : undefined)}

      {looseFloors.map((f) => (
        <Paper key={f.id} variant="outlined" sx={{ p: 2 }}>
          <AreaHead area={f} count={roomsIn(f.id).length} onRename={() => setNaming({ kind: 'floor', parent: null, area: f })} onDelete={() => setDeletingArea(f)} />
          {place(f.id)}
        </Paper>
      ))}

      {buildings.map((b) => {
        const floors = floorsOf(b.id)
        const count = roomsIn(b.id).length + floors.reduce((n, f) => n + roomsIn(f.id).length, 0)
        return (
          <Paper key={b.id} variant="outlined" sx={{ p: 2 }}>
            <AreaHead area={b} count={count} onRename={() => setNaming({ kind: 'building', parent: null, area: b })} onDelete={() => setDeletingArea(b)} />
            {(floors.length === 0 || roomsIn(b.id).length > 0) && place(b.id)}
            <Stack spacing={1.5} sx={{ mt: floors.length ? 1.5 : 0 }}>
              {floors.map((f) => (
                <Box key={f.id} sx={{ pl: 1.5, borderInlineStart: `3px solid ${tokens.lineSoft}` }}>
                  <AreaHead area={f} count={roomsIn(f.id).length} small onRename={() => setNaming({ kind: 'floor', parent: b.id, area: f })} onDelete={() => setDeletingArea(f)} />
                  {place(f.id)}
                </Box>
              ))}
            </Stack>
            <Button size="small" startIcon={<LayersOutlined />} onClick={() => setNaming({ kind: 'floor', parent: b.id })} sx={{ mt: 1.5 }}>
              {t('rooms.addFloorIn', { name: b.name })}
            </Button>
          </Paper>
        )
      })}

      {naming && (
        <NameDialog
          title={t(naming.area ? 'rooms.rename' : naming.kind === 'building' ? 'rooms.addBuilding' : 'rooms.addFloor')}
          label={t(naming.kind === 'building' ? 'rooms.buildingName' : 'rooms.floorName')}
          initial={naming.area?.name ?? (naming.kind === 'building' ? t('rooms.buildingN', { n: buildings.length + 1 }) : nextFloor(naming.parent))}
          busy={saveArea.isPending}
          onClose={() => setNaming(null)}
          onSave={(name) => saveArea.mutate({ name, kind: naming.kind, parent: naming.parent, area: naming.area })}
        />
      )}
      {deletingArea && (
        <Dialog open onClose={() => setDeletingArea(null)} fullWidth maxWidth="xs">
          <DialogTitle>{t('rooms.deleteArea', { name: deletingArea.name })}</DialogTitle>
          <DialogContent>
            <Typography>{t('rooms.deleteAreaHint')}</Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeletingArea(null)}>{t('common.cancel')}</Button>
            <Button variant="contained" color="error" loading={removeArea.isPending} onClick={() => removeArea.mutate(deletingArea.id)}>
              {t('common.delete')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {editing && <RoomDialog schoolId={schoolId} room={editing} areas={list} onClose={() => setEditing(null)} />}
      {bulk !== undefined && <BulkDialog schoolId={schoolId} area={bulk} existing={all.map((r) => r.name)} onClose={() => setBulk(undefined)} />}
    </Stack>
  )
}

function AreaHead({ area, count, small, onRename, onDelete }: { area: RoomArea; count: number; small?: boolean; onRename: () => void; onDelete: () => void }) {
  const { t } = useI18n()
  const Icon = area.kind === 'building' ? ApartmentOutlined : LayersOutlined
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
      <Icon sx={{ fontSize: small ? 18 : 20, color: tokens.accent }} />
      <Typography sx={{ fontWeight: 600, fontSize: small ? 14 : 15.5 }}>{area.name}</Typography>
      <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted, flex: 1 }}>{t('rooms.count', { n: count })}</Typography>
      <Tooltip title={t('rooms.rename')}>
        <IconButton size="small" aria-label={`${t('rooms.rename')} — ${area.name}`} onClick={onRename}>
          <EditOutlined sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('common.delete')}>
        <IconButton size="small" aria-label={`${t('common.delete')} — ${area.name}`} onClick={onDelete}>
          <DeleteOutlined sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

// The rooms of one place, as tiles, and where to type the next one
function Place({
  title,
  rooms,
  reservedFor,
  onAdd,
  onOpen,
  onBulk,
}: {
  title?: React.ReactNode
  rooms: Room[]
  reservedFor: (id: string) => string[]
  onAdd: (name: string) => Promise<unknown>
  onOpen: (r: Room) => void
  onBulk: () => void
}) {
  const { t } = useI18n()
  return (
    <Box>
      {title && <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 1 }}>{title}</Typography>}
      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {rooms.map((r) => {
          const reserved = reservedFor(r.id)
          return (
            <ButtonBase
              key={r.id}
              onClick={() => onOpen(r)}
              aria-label={`${t('rooms.edit')} — ${r.name}`}
              sx={{
                display: 'block',
                textAlign: 'start',
                p: 1.25,
                borderRadius: '8px',
                border: `1px solid ${tokens.line}`,
                bgcolor: tokens.card,
                '&:hover': { borderColor: tokens.accentLine, bgcolor: tokens.fill },
              }}
            >
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <MeetingRoomOutlined sx={{ fontSize: 16, color: tokens.inkMuted }} />
                <Typography noWrap sx={{ fontWeight: 600, fontSize: 14 }}>
                  {r.name}
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 12, color: tokens.inkMuted, mt: 0.25 }}>
                {r.capacity ? t('rooms.seats', { n: r.capacity }) : t('rooms.noCapacity')}
              </Typography>
              {reserved.length > 0 && <Tag tone="info" label={reserved.join(', ')} sx={{ mt: 0.5, maxWidth: '100%' }} />}
            </ButtonBase>
          )
        })}
        <AddTile onAdd={onAdd} onBulk={onBulk} />
      </Box>
    </Box>
  )
}

// "+ Salle": type a name, Enter, type the next one
function AddTile({ onAdd, onBulk }: { onAdd: (name: string) => Promise<unknown>; onBulk: () => void }) {
  const { t } = useI18n()
  const [typing, setTyping] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const box = {
    minHeight: 64,
    p: 1.25,
    borderRadius: '8px',
    border: `1px dashed ${tokens.accentLine}`,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
  } as const
  if (!typing)
    return (
      <Box sx={{ ...box, gap: 0.25 }}>
        <ButtonBase onClick={() => setTyping(true)} sx={{ justifyContent: 'flex-start', gap: 0.5, color: tokens.accentDark, fontWeight: 600, fontSize: 14, borderRadius: '6px' }}>
          <AddOutlined sx={{ fontSize: 18 }} />
          {t('rooms.addRoom')}
        </ButtonBase>
        <ButtonBase onClick={onBulk} sx={{ justifyContent: 'flex-start', gap: 0.5, color: tokens.inkMuted, fontSize: 12.5, borderRadius: '6px' }}>
          <PlaylistAddOutlined sx={{ fontSize: 16 }} />
          {t('rooms.addMany')}
        </ButtonBase>
      </Box>
    )
  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onAdd(name)
      setName('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Box sx={{ ...box, borderStyle: 'solid', bgcolor: tokens.card }}>
      <InputBase
        autoFocus
        placeholder={t('rooms.namePlaceholder')}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') (setTyping(false), setName(''))
        }}
        onBlur={() => !name.trim() && setTyping(false)}
        inputProps={{ 'aria-label': t('rooms.addRoom') }}
        sx={{ fontWeight: 600, fontSize: 14 }}
      />
      <Typography sx={{ fontSize: 11.5, color: tokens.inkMuted }}>{t('rooms.enterHint')}</Typography>
    </Box>
  )
}

function NameDialog({ title, label, initial, busy, onClose, onSave }: { title: string; label: string; initial: string; busy: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(initial)
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField
          label={label}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name)}
          autoFocus
          fullWidth
          sx={{ mt: 1 }}
          slotProps={{ htmlInput: { onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.target.select() } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={!name.trim()} loading={busy} onClick={() => onSave(name)}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// One room: name, seats, a subject that owns it, where it is
function RoomDialog({ schoolId, room, areas, onClose }: { schoolId: string; room: Room; areas: RoomArea[]; onClose: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const subjects = useQuery(subjectsQuery(schoolId))
  const owner = (subjects.data ?? []).find((s) => s.room_id === room.id)
  const [name, setName] = useState(room.name)
  const [capacity, setCapacity] = useState(room.capacity ? String(room.capacity) : '')
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [area, setArea] = useState(room.area_id ?? '')
  const subject = subjectId ?? owner?.id ?? ''
  const label = (a: RoomArea) => {
    const parent = areas.find((x) => x.id === a.parent_id)
    return parent ? `${parent.name} › ${a.name}` : a.name
  }
  const places = [...areas].sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }))

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ['school', schoolId] })
    onClose()
  }
  const save = useMutation({
    mutationFn: async () => {
      must(
        await supabase
          .from('rooms')
          .update({ name: name.trim(), capacity: capacity ? Number(capacity) : null, area_id: area || null })
          .eq('id', room.id),
      )
      if (subject !== (owner?.id ?? '')) {
        if (owner) must(await supabase.from('subjects').update({ room_id: null }).eq('id', owner.id))
        if (subject) must(await supabase.from('subjects').update({ room_id: room.id }).eq('id', subject))
      }
    },
    onSuccess: done,
  })
  const remove = useMutation({
    mutationFn: async () => must(await supabase.from('rooms').delete().eq('id', room.id)),
    onSuccess: done,
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{room.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          <TextField label={t('rooms.capacity')} type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <TextField select label={t('rooms.usage')} value={subject} onChange={(e) => setSubjectId(e.target.value)}>
            <MenuItem value="">{t('rooms.study')}</MenuItem>
            {(subjects.data ?? []).map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {t('rooms.reservedFor', { subject: s.name })}
              </MenuItem>
            ))}
          </TextField>
          {areas.length > 0 && (
            <TextField select label={t('rooms.place')} value={area} onChange={(e) => setArea(e.target.value)}>
              <MenuItem value="">{t('rooms.unplaced')}</MenuItem>
              {places.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {label(a)}
                </MenuItem>
              ))}
            </TextField>
          )}
          {(save.isError || remove.isError) && <Alert severity="error">{errorMessage(save.error ?? remove.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="error" startIcon={<DeleteOutlined />} onClick={() => remove.mutate()} loading={remove.isPending} sx={{ mr: 'auto' }}>
          {t('common.delete')}
        </Button>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// "Salle 1 à Salle 12" in one go (names already used are skipped)
function BulkDialog({ schoolId, area, existing, onClose }: { schoolId: string; area: string | null; existing: string[]; onClose: () => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [prefix, setPrefix] = useState(t('rooms.defaultPrefix'))
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('10')
  const [capacity, setCapacity] = useState('')
  const a = Number(from)
  const b = Number(to)
  const valid = Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a && b - a < 100
  const names = valid ? Array.from({ length: b - a + 1 }, (_, i) => `${prefix}${a + i}`.trim()) : []
  const fresh = names.filter((n) => !existing.includes(n))
  const add = useMutation({
    mutationFn: async () =>
      must(
        await supabase
          .from('rooms')
          .insert(fresh.map((name) => ({ school_id: schoolId, name, area_id: area, capacity: capacity ? Number(capacity) : null }))),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', schoolId] })
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('rooms.addMany')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label={t('rooms.prefix')} value={prefix} onChange={(e) => setPrefix(e.target.value)} helperText={t('rooms.prefixHint')} />
          <Stack direction="row" spacing={1.5}>
            <TextField label={t('rooms.from')} type="number" value={from} onChange={(e) => setFrom(e.target.value)} />
            <TextField label={t('rooms.to')} type="number" value={to} onChange={(e) => setTo(e.target.value)} />
          </Stack>
          <TextField label={t('rooms.capacity')} type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          {names.length > 0 && (
            <Typography sx={{ fontSize: 13.5, color: tokens.inkMuted }}>
              {t('rooms.preview', { first: names[0], last: names[names.length - 1], n: fresh.length })}
            </Typography>
          )}
          {add.isError && <Alert severity="error">{errorMessage(add.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => add.mutate()} loading={add.isPending} disabled={!fresh.length}>
          {t('rooms.addN', { n: fresh.length })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
