import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { Box, Paper, Typography } from '@mui/material'
import { tokens } from '#/theme/theme'
import { useI18n } from '#/i18n/i18n'
import { toMin, fromMin } from '#/features/setup/schedule'
import type { Band } from './WeekGrid'

// Google Calendar-like editor of a week's trame: sessions are dragged to
// another time or day (Alt/Ctrl + drag copies), stretched from their top or
// bottom edge, created by sweeping a free moment, or dropped from the palette.
// The grid only reports intentions; the parent saves them.

export type PlannerSlot = {
  id: string
  weekday: number
  start: string // HH:MM
  end: string
  title: string
  lines: string[]
  color: { bg: string; ink: string }
  teacherId: string | null
  pending?: boolean
}

export type Busy = { teacherId: string; weekday: number; start: string; end: string; label: string }

// What a session would hit at a given place: 'bad' refuses the drop
export type Verdict = { level: 'ok' | 'warn' | 'bad'; message?: string }

export type Place = { weekday: number; start: string; end: string }

// A session taken from the palette (not yet in the trame)
export type NewItem = { key: string; title: string; color: { bg: string; ink: string }; minutes: number; teacherId: string | null }

type Drag =
  | { kind: 'move'; id: string; offset: number; minutes: number; copy: boolean; x: number; y: number; moved: boolean; el: HTMLElement }
  | { kind: 'resize'; id: string; edge: 'start' | 'end'; moved: boolean }
  | { kind: 'sweep'; weekday: number; anchor: number; x: number; y: number; moved: boolean }
  | { kind: 'new'; item: NewItem; x: number; y: number }

const SCALE = 1.4 // px per minute
const SNAP = 5
const MIN_LEN = 10
const HANDLE = 7 // px of the top/bottom edge that resizes

const snap = (m: number) => Math.round(m / SNAP) * SNAP

export function Planner({
  days,
  dayLabels,
  slots,
  bands = [],
  busy = [],
  dayRanges,
  dayStart,
  dayEnd,
  check,
  onPlace,
  onCreate,
  onOpen,
  onDrop,
  onNudge,
  onDelete,
  aside,
}: {
  days: number[]
  dayLabels: Record<number, string>
  slots: PlannerSlot[]
  bands?: Band[]
  // Teachers' sessions in other classes: shown while their session is dragged
  busy?: Busy[]
  dayRanges?: Record<number, { start: string; end: string } | undefined>
  dayStart: string
  dayEnd: string
  check: (place: Place, ignoreId: string | null, teacherId: string | null) => Verdict
  onPlace: (id: string, place: Place, how: 'move' | 'resize' | 'copy') => void
  onCreate: (place: Place, swept: boolean) => void
  onOpen: (id: string, anchor: HTMLElement) => void
  onDrop: (item: NewItem, place: Place) => void
  onNudge: (id: string, place: Place) => void
  onDelete: (id: string) => void
  aside: (startDrag: (e: ReactPointerEvent, item: NewItem) => void) => ReactNode
}) {
  const { t, dir } = useI18n()
  const cols = useRef(new Map<number, HTMLElement>())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [ghost, setGhost] = useState<(Place & { verdict: Verdict }) | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const ghostRef = useRef<typeof ghost>(null)
  dragRef.current = drag
  ghostRef.current = ghost

  const earliest = Math.min(toMin(dayStart), ...slots.map((s) => toMin(s.start)), ...bands.map((b) => toMin(b.start)))
  const latest = Math.max(toMin(dayEnd), ...slots.map((s) => toMin(s.end)), ...bands.map((b) => toMin(b.end)))
  const height = (latest - earliest) * SCALE
  const hours: number[] = []
  for (let m = Math.ceil(earliest / 60) * 60; m <= latest; m += 60) hours.push(m)
  const halves = hours.map((m) => m + 30).filter((m) => m < latest)

  // Pointer → (day, minute) of the grid, or null outside the columns
  const locate = (x: number, y: number) => {
    for (const [weekday, el] of cols.current) {
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right) return { weekday, minute: earliest + (y - r.top) / SCALE }
    }
    return null
  }
  const slotById = (id: string) => slots.find((s) => s.id === id)
  const clampPlace = (weekday: number, start: number, minutes: number): Place => {
    const s = Math.max(earliest, Math.min(snap(start), latest - minutes))
    return { weekday, start: fromMin(s), end: fromMin(s + minutes) }
  }
  const show = (place: Place | null, ignoreId: string | null, teacherId: string | null) =>
    setGhost(place && { ...place, verdict: check(place, ignoreId, teacherId) })

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const d = dragRef.current!
      setPointer({ x: e.clientX, y: e.clientY })
      if ((d.kind === 'move' || d.kind === 'sweep') && !d.moved) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
        setDrag({ ...d, moved: true })
      }
      const at = locate(e.clientX, e.clientY)
      if (d.kind === 'move') {
        const s = slotById(d.id)!
        if (!at) return show(null, null, null)
        show(clampPlace(at.weekday, at.minute - d.offset, d.minutes), d.copy ? null : d.id, s.teacherId)
      } else if (d.kind === 'resize') {
        const s = slotById(d.id)!
        // the edge follows the pointer's height, even outside the column
        const m = snap(earliest + (e.clientY - cols.current.get(s.weekday)!.getBoundingClientRect().top) / SCALE)
        if (!d.moved) setDrag({ ...d, moved: true })
        const place =
          d.edge === 'end'
            ? { weekday: s.weekday, start: s.start, end: fromMin(Math.min(latest, Math.max(toMin(s.start) + MIN_LEN, m))) }
            : { weekday: s.weekday, start: fromMin(Math.max(earliest, Math.min(toMin(s.end) - MIN_LEN, m))), end: s.end }
        show(place, s.id, s.teacherId)
      } else if (d.kind === 'sweep') {
        const m = snap(Math.max(earliest, Math.min(latest, at && at.weekday === d.weekday ? at.minute : earliest + (e.clientY - cols.current.get(d.weekday)!.getBoundingClientRect().top) / SCALE)))
        const [a, b] = m >= d.anchor ? [d.anchor, Math.max(m, d.anchor + SNAP)] : [m, d.anchor]
        show({ weekday: d.weekday, start: fromMin(a), end: fromMin(b) }, null, null)
      } else if (d.kind === 'new') {
        if (!at) return show(null, null, null)
        show(clampPlace(at.weekday, at.minute - Math.min(15, d.item.minutes / 2), d.item.minutes), null, d.item.teacherId)
      }
    }
    const up = () => {
      const d = dragRef.current!
      const g = ghostRef.current
      setDrag(null)
      setGhost(null)
      setPointer(null)
      if (d.kind === 'move' && !d.moved) return onOpen(d.id, d.el)
      if (d.kind === 'sweep' && !d.moved) return onCreate({ weekday: d.weekday, start: fromMin(snap(d.anchor - 2)), end: '' }, false)
      if (!g || g.verdict.level === 'bad') return
      if (d.kind === 'move') {
        const s = slotById(d.id)!
        if (!d.copy && s.weekday === g.weekday && s.start === g.start) return
        onPlace(d.id, g, d.copy ? 'copy' : 'move')
      } else if (d.kind === 'resize') {
        const s = slotById(d.id)!
        if (s.start !== g.start || s.end !== g.end) onPlace(d.id, g, 'resize')
      } else if (d.kind === 'sweep') onCreate(g, true)
      else onDrop(d.item, g)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      dragRef.current = null
      setDrag(null)
      setGhost(null)
      setPointer(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key)
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key)
      document.body.style.userSelect = ''
    }
    // Listeners live for one drag; they read the latest state through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.kind])

  const startNew = (e: ReactPointerEvent, item: NewItem) => {
    if (e.button !== 0) return
    e.preventDefault()
    setPointer({ x: e.clientX, y: e.clientY })
    setDrag({ kind: 'new', item, x: e.clientX, y: e.clientY })
  }

  const onSlotDown = (e: ReactPointerEvent<HTMLElement>, s: PlannerSlot) => {
    if (e.button !== 0 || s.pending) return
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - r.top
    const minutes = toMin(s.end) - toMin(s.start)
    if (r.height >= 24 && y <= HANDLE) return setDrag({ kind: 'resize', id: s.id, edge: 'start', moved: false })
    if (r.height >= 24 && y >= r.height - HANDLE) return setDrag({ kind: 'resize', id: s.id, edge: 'end', moved: false })
    setDrag({ kind: 'move', id: s.id, offset: y / SCALE, minutes, copy: e.altKey || e.ctrlKey || e.metaKey, x: e.clientX, y: e.clientY, moved: false, el: e.currentTarget })
  }

  // Keyboard: arrows move (Shift + ↑↓ changes the length), Delete removes
  const onSlotKey = (e: React.KeyboardEvent<HTMLElement>, s: PlannerSlot) => {
    if (s.pending) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      return onOpen(s.id, e.currentTarget)
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      return onDelete(s.id)
    }
    const a = toMin(s.start)
    const b = toMin(s.end)
    const i = days.indexOf(s.weekday)
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    let place: Place | null = null
    if (e.key === 'ArrowUp' && e.shiftKey) place = { ...s, end: fromMin(Math.max(a + MIN_LEN, b - SNAP)) }
    else if (e.key === 'ArrowDown' && e.shiftKey) place = { ...s, end: fromMin(Math.min(latest, b + SNAP)) }
    else if (e.key === 'ArrowUp') place = clampPlace(s.weekday, a - SNAP, b - a)
    else if (e.key === 'ArrowDown') place = clampPlace(s.weekday, a + SNAP, b - a)
    else if (e.key === forward && i < days.length - 1) place = { ...s, weekday: days[i + 1] }
    else if (e.key === back && i > 0) place = { ...s, weekday: days[i - 1] }
    if (!place) return
    e.preventDefault()
    const p = { weekday: place.weekday, start: place.start, end: place.end }
    if (check(p, s.id, s.teacherId).level !== 'bad') onNudge(s.id, p)
  }

  const onColumnDown = (e: ReactPointerEvent<HTMLElement>, weekday: number) => {
    if (e.button !== 0) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    // Touch: a tap opens the form; sweeping is kept for scrolling the page
    if (e.pointerType !== 'mouse') return onCreate({ weekday, start: fromMin(snap(earliest + y / SCALE - 2)), end: '' }, false)
    setDrag({ kind: 'sweep', weekday, anchor: snap(earliest + y / SCALE), x: e.clientX, y: e.clientY, moved: false })
  }

  const dragged = drag && (drag.kind === 'move' || drag.kind === 'resize') ? drag.id : null
  const draggedTeacher =
    drag?.kind === 'new' ? drag.item.teacherId : dragged && (drag?.kind === 'resize' || (drag?.kind === 'move' && drag.moved)) ? (slotById(dragged)?.teacherId ?? null) : null
  const active = !!drag && (drag.kind === 'new' || drag.kind === 'resize' || drag.moved)
  const verdictColor = (v: Verdict) => (v.level === 'bad' ? tokens.dangerInk : v.level === 'warn' ? '#9A5B12' : tokens.accent)
  const ghostItem =
    drag?.kind === 'new' ? { title: drag.item.title, color: drag.item.color } : dragged ? slotById(dragged) : null

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 300px' }, alignItems: 'start' }}>
      <Paper variant="outlined" sx={{ overflowX: 'auto', cursor: active ? (drag?.kind === 'resize' ? 'ns-resize' : 'grabbing') : undefined }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: `52px repeat(${days.length}, minmax(130px, 1fr))`, minWidth: 52 + days.length * 130 }}>
          <Box sx={{ borderBottom: `1px solid ${tokens.line}` }} />
          {days.map((d) => (
            <Box key={d} sx={{ p: 1.25, borderBottom: `1px solid ${tokens.line}`, borderInlineStart: `1px solid ${tokens.lineSoft}` }}>
              <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{dayLabels[d]}</Typography>
            </Box>
          ))}
          <Box sx={{ position: 'relative', height }}>
            {hours.map((m) => (
              <Typography key={m} sx={{ position: 'absolute', top: (m - earliest) * SCALE - 7, insetInlineEnd: 6, fontSize: 11, color: tokens.inkMuted }}>
                {fromMin(m)}
              </Typography>
            ))}
          </Box>
          {days.map((d) => {
            const range = dayRanges?.[d]
            const shade = (from: number, to: number, k: string) =>
              to > from && (
                <Box
                  key={k}
                  sx={{
                    position: 'absolute',
                    insetInline: 0,
                    top: (from - earliest) * SCALE,
                    height: (to - from) * SCALE,
                    bgcolor: tokens.paper,
                    backgroundImage: `repeating-linear-gradient(135deg, transparent 0 6px, ${tokens.lineSoft} 6px 7px)`,
                    pointerEvents: 'none',
                  }}
                />
              )
            return (
              <Box
                key={d}
                ref={(el: HTMLElement | null) => {
                  if (el) cols.current.set(d, el)
                  else cols.current.delete(d)
                }}
                onPointerDown={(e) => onColumnDown(e, d)}
                sx={{ position: 'relative', height, borderInlineStart: `1px solid ${tokens.lineSoft}`, cursor: active ? undefined : 'cell' }}
              >
                {hours.map((m) => (
                  <Box key={m} sx={{ position: 'absolute', insetInline: 0, top: (m - earliest) * SCALE, borderTop: `1px solid ${tokens.lineSoft}`, pointerEvents: 'none' }} />
                ))}
                {halves.map((m) => (
                  <Box key={m} sx={{ position: 'absolute', insetInline: 0, top: (m - earliest) * SCALE, borderTop: `1px dotted ${tokens.lineSoft}`, pointerEvents: 'none' }} />
                ))}
                {dayRanges && (range ? [shade(earliest, toMin(range.start), 'b'), shade(toMin(range.end), latest, 'a')] : shade(earliest, latest, 'x'))}
                {bands
                  .filter((b) => b.weekday === d)
                  .map((b, i) => (
                    <Box
                      key={`band-${i}`}
                      title={`${b.label} ${b.start}–${b.end}`}
                      sx={{
                        position: 'absolute',
                        insetInline: 4,
                        top: (toMin(b.start) - earliest) * SCALE,
                        height: Math.max(12, (toMin(b.end) - toMin(b.start)) * SCALE - 2),
                        borderRadius: '8px',
                        bgcolor: b.kind === 'nap' ? '#EFEBF6' : b.kind === 'recess' ? '#FBF3E3' : '#F4F1EA',
                        border: `1px dashed ${tokens.line}`,
                        px: 0.75,
                        display: 'flex',
                        alignItems: 'center',
                        overflow: 'hidden',
                        pointerEvents: 'none',
                      }}
                    >
                      <Typography noWrap sx={{ fontSize: 11, color: tokens.inkMuted, fontStyle: 'italic' }}>
                        {(toMin(b.end) - toMin(b.start)) * SCALE >= 20 ? `${b.start} ${b.label}` : b.label}
                      </Typography>
                    </Box>
                  ))}
                {draggedTeacher &&
                  busy
                    .filter((b) => b.teacherId === draggedTeacher && b.weekday === d)
                    .map((b, i) => (
                      <Box
                        key={`busy-${i}`}
                        sx={{
                          position: 'absolute',
                          insetInlineEnd: 0,
                          width: 6,
                          top: (toMin(b.start) - earliest) * SCALE,
                          height: (toMin(b.end) - toMin(b.start)) * SCALE,
                          bgcolor: tokens.dangerInk,
                          opacity: 0.55,
                          borderRadius: 1,
                          zIndex: 3,
                          pointerEvents: 'none',
                        }}
                        title={b.label}
                      />
                    ))}
                {slots
                  .filter((s) => s.weekday === d)
                  .map((s) => {
                    const top = (toMin(s.start) - earliest) * SCALE
                    const h = Math.max(18, (toMin(s.end) - toMin(s.start)) * SCALE - 3)
                    const lifted = s.id === dragged && active && !(drag?.kind === 'move' && drag.copy)
                    return (
                      <Box
                        key={s.id}
                        role="button"
                        tabIndex={s.pending ? -1 : 0}
                        aria-label={`${s.title} ${dayLabels[s.weekday]} ${s.start}–${s.end} ${s.lines.join(' ')}`}
                        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Delete Enter"
                        onPointerDown={(e) => onSlotDown(e, s)}
                        onKeyDown={(e) => onSlotKey(e, s)}
                        sx={{
                          position: 'absolute',
                          top,
                          height: h,
                          insetInline: 4,
                          borderRadius: '10px',
                          bgcolor: s.color.bg,
                          color: s.color.ink,
                          border: `1px solid ${s.color.ink}22`,
                          p: 0.75,
                          overflow: 'hidden',
                          zIndex: 2,
                          touchAction: 'none',
                          cursor: s.pending ? 'progress' : active ? 'inherit' : 'grab',
                          opacity: lifted ? 0.35 : s.pending ? 0.6 : 1,
                          transition: 'box-shadow 120ms, opacity 120ms',
                          '&:hover': { boxShadow: active ? undefined : '0 2px 8px rgba(28,26,22,0.14)' },
                          '&:focus-visible': { outline: `2px solid ${tokens.accent}`, outlineOffset: 1 },
                          // resize grips, visible on hover like Google Calendar
                          '&::before, &::after':
                            h >= 24 ? { content: '""', position: 'absolute', insetInline: 0, height: HANDLE, cursor: 'ns-resize' } : {},
                          '&::before': { top: 0 },
                          '&::after': { bottom: 0 },
                          '&:hover .grip': { opacity: h >= 24 ? 0.5 : 0 },
                        }}
                      >
                        <Box className="grip" sx={{ position: 'absolute', bottom: 2, left: '50%', width: 18, height: 3, ml: '-9px', borderRadius: 2, bgcolor: 'currentColor', opacity: 0, transition: 'opacity 120ms', pointerEvents: 'none' }} />
                        <SlotContent start={s.start} end={s.end} title={s.title} lines={s.lines} height={h} />
                      </Box>
                    )
                  })}
                {ghost && ghost.weekday === d && ghostItem && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: (toMin(ghost.start) - earliest) * SCALE,
                      height: Math.max(18, (toMin(ghost.end) - toMin(ghost.start)) * SCALE - 3),
                      insetInline: 4,
                      borderRadius: '10px',
                      bgcolor: ghost.verdict.level === 'bad' ? tokens.dangerSoft : ghostItem.color.bg,
                      color: ghostItem.color.ink,
                      border: `2px solid ${verdictColor(ghost.verdict)}`,
                      boxShadow: '0 6px 18px rgba(28,26,22,0.22)',
                      p: 0.75,
                      overflow: 'hidden',
                      zIndex: 4,
                      pointerEvents: 'none',
                    }}
                  >
                    <SlotContent start={ghost.start} end={ghost.end} title={ghostItem.title} lines={[]} height={999} strong />
                  </Box>
                )}
                {ghost && ghost.weekday === d && !ghostItem && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: (toMin(ghost.start) - earliest) * SCALE,
                      height: (toMin(ghost.end) - toMin(ghost.start)) * SCALE,
                      insetInline: 4,
                      borderRadius: '10px',
                      bgcolor: tokens.accentSoft,
                      border: `2px dashed ${verdictColor(ghost.verdict)}`,
                      px: 0.75,
                      zIndex: 4,
                      pointerEvents: 'none',
                    }}
                  >
                    <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: tokens.accentDark }}>
                      <Range start={ghost.start} end={ghost.end} />
                    </Typography>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      </Paper>
      {aside(startNew)}
      {/* Tooltip under the pointer: where it lands, and why it can't */}
      {active && pointer && (
        <Box
          sx={{
            position: 'fixed',
            left: pointer.x + 14,
            top: pointer.y + 14,
            zIndex: 1600,
            pointerEvents: 'none',
            bgcolor: tokens.ink,
            color: '#fff',
            borderRadius: 1.5,
            px: 1,
            py: 0.5,
            fontSize: 12,
            boxShadow: 3,
            maxWidth: 280,
          }}
        >
          {ghost ? (
            <>
              <b>
                {dayLabels[ghost.weekday]} <Range start={ghost.start} end={ghost.end} />
              </b>
              {drag?.kind === 'move' && drag.copy && ` · ${t('tt.copy')}`}
              {ghost.verdict.message && (
                <Box component="span" sx={{ display: 'block', color: ghost.verdict.level === 'bad' ? '#F4B4A8' : '#F3D9A6' }}>
                  {ghost.verdict.message}
                </Box>
              )}
            </>
          ) : drag?.kind === 'new' ? (
            drag.item.title
          ) : (
            t('tt.dropOutside')
          )}
        </Box>
      )}
    </Box>
  )
}

// Times read left to right, in Arabic too
export function Range({ start, end }: { start: string; end: string }) {
  return (
    <Box component="span" dir="ltr" sx={{ unicodeBidi: 'isolate' }}>
      {start} – {end}
    </Box>
  )
}

function SlotContent({ start, end, title, lines, height, strong }: { start: string; end: string; title: string; lines: string[]; height: number; strong?: boolean }) {
  const tall = height >= 38
  return (
    <>
      {tall ? (
        <>
          <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>
            {title}
          </Typography>
          <Typography noWrap sx={{ fontSize: 11, fontWeight: strong ? 700 : 500, opacity: 0.85 }}>
            <Range start={start} end={end} />
          </Typography>
        </>
      ) : (
        <Typography noWrap sx={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.2 }}>
          {title}
          <Box component="span" sx={{ fontWeight: strong ? 700 : 400, opacity: 0.8 }}>
            {' '}
            · {start}
          </Box>
        </Typography>
      )}
      {lines.slice(0, Math.max(0, Math.floor((height - 40) / 16))).map((l, i) => (
        <Typography key={i} noWrap sx={{ fontSize: 11.5, opacity: 0.85 }}>
          {l}
        </Typography>
      ))}
    </>
  )
}
