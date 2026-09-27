import { Box, ButtonBase, Paper, Stack, Typography } from '@mui/material'
import { tokens } from '#/theme/theme'
import { hhmm } from '#/lib/format'
import { timeAxis } from './timeAxis'

export type Block = {
  key: string
  weekday: number
  start: string
  end: string
  title: string
  lines?: string[]
  color: { bg: string; ink: string }
  strike?: boolean
  badge?: string
  onClick?: () => void
}

// Non-teaching moments drawn behind the sessions (récréation, sieste...).
export type Band = { weekday: number; start: string; end: string; label: string; kind?: string }

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Week grid (mockup "La semaine d'une classe"): one column per school day,
// blocks sized by duration, but never too short to read (see timeAxis).
// Scrolls horizontally on phones.
const BLOCK_MIN = 30 // px: time + title on one line
// A session with a teacher (or other details) always shows its first line
// under the title, however short it is: the teacher must be visible
const BLOCK_MIN_LINES = 46
const BAND_MIN = 18 // px: a pause label
const TICK_GAP = 14 // px between two ruler labels
export function WeekGrid({
  days,
  dayLabels,
  blocks,
  dayStart = '08:00',
  dayEnd = '17:00',
  dayNotes,
  emptyText,
  bands,
  dayRanges,
  onEmptyClick,
}: {
  days: number[]
  dayLabels: Record<number, string>
  blocks: Block[]
  dayStart?: string
  dayEnd?: string
  dayNotes?: Record<number, string | undefined>
  emptyText?: string
  bands?: Band[]
  // Opening hours of each day: outside is shaded (Friday ending at 12:30)
  dayRanges?: Record<number, { start: string; end: string } | undefined>
  // Click on an empty spot of a day: time rounded down to 5 minutes
  onEmptyClick?: (weekday: number, time: string) => void
}) {
  const earliest = Math.min(toMin(dayStart), ...blocks.map((b) => toMin(b.start)), ...(bands ?? []).map((b) => toMin(b.start)))
  const latest = Math.max(toMin(dayEnd), ...blocks.map((b) => toMin(b.end)), ...(bands ?? []).map((b) => toMin(b.end)))
  const axis = timeAxis(
    earliest,
    latest,
    [
      ...blocks.map((b) => ({ start: toMin(b.start), end: toMin(b.end), min: b.lines?.length ? BLOCK_MIN_LINES : BLOCK_MIN })),
      ...(bands ?? []).map((b) => ({ start: toMin(b.start), end: toMin(b.end), min: BAND_MIN })),
    ],
    1.1, // px per minute where nothing needs more room
  )
  const y = (m: number) => axis.y(m) - axis.y(earliest)
  const height = axis.height
  // Ruler: the times something starts (not round hours, which the stretched
  // axis would scatter), skipping a label too close to the previous one
  const starts = new Set([...blocks, ...(bands ?? [])].map((b) => toMin(b.start)))
  const ticks: number[] = []
  for (const m of axis.cuts) if (starts.has(m) && (!ticks.length || y(m) - y(ticks[ticks.length - 1]) >= TICK_GAP)) ticks.push(m)

  return (
    <Paper variant="outlined" sx={{ overflowX: 'auto', bgcolor: tokens.content }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `52px repeat(${days.length}, minmax(130px, 1fr))`, minWidth: 52 + days.length * 130 }}>
        <Box />
        {days.map((d) => (
          <Box key={d} sx={{ p: 1.25, borderBottom: `1px solid ${tokens.line}`, borderInlineStart: `1px solid ${tokens.lineSoft}` }}>
            <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{dayLabels[d]}</Typography>
            {dayNotes?.[d] && <Typography sx={{ fontSize: 11.5, color: tokens.warnInk }}>{dayNotes[d]}</Typography>}
          </Box>
        ))}
        <Box sx={{ position: 'relative', height }}>
          {ticks.map((m) => (
            <Typography
              key={m}
              sx={{
                position: 'absolute',
                top: y(m) - 1,
                insetInlineEnd: 6,
                fontSize: 11,
                lineHeight: 1,
                color: m % 60 === 0 ? tokens.inkSoft : tokens.inkMuted,
                fontWeight: m % 60 === 0 ? 600 : 400,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {String(Math.floor(m / 60)).padStart(2, '0')}:{String(m % 60).padStart(2, '0')}
            </Typography>
          ))}
        </Box>
        {days.map((d) => (
          <Box
            key={d}
            onClick={
              onEmptyClick
                ? (e) => {
                    const py = e.clientY - e.currentTarget.getBoundingClientRect().top
                    const m = Math.floor(axis.minuteAt(py) / 5) * 5
                    onEmptyClick(d, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
                  }
                : undefined
            }
            sx={{ position: 'relative', height, borderInlineStart: `1px solid ${tokens.lineSoft}`, cursor: onEmptyClick ? 'copy' : undefined }}
          >
            {ticks.map((m) => (
              <Box key={m} sx={{ position: 'absolute', insetInline: 0, top: y(m), borderTop: `1px dotted ${tokens.lineSoft}` }} />
            ))}
            {dayRanges &&
              (() => {
                const r = dayRanges[d]
                const shade = (from: number, to: number, k: string) =>
                  to > from && (
                    <Box
                      key={k}
                      sx={{
                        position: 'absolute',
                        insetInline: 0,
                        top: y(from),
                        height: y(to) - y(from),
                        bgcolor: tokens.card,
                        backgroundImage: `repeating-linear-gradient(135deg, transparent 0 6px, ${tokens.lineSoft} 6px 7px)`,
                      }}
                    />
                  )
                return r ? [shade(earliest, toMin(r.start), 'b'), shade(toMin(r.end), latest, 'a')] : shade(earliest, latest, 'x')
              })()}
            {(bands ?? [])
              .filter((b) => b.weekday === d)
              .map((b, i) => (
                <Box
                  key={`band-${i}`}
                  title={`${b.label} ${hhmm(b.start)}–${hhmm(b.end)}`}
                  sx={{
                    position: 'absolute',
                    insetInline: 4,
                    top: y(toMin(b.start)),
                    height: Math.max(12, y(toMin(b.end)) - y(toMin(b.start)) - 2),
                    borderRadius: '8px',
                    bgcolor: b.kind === 'nap' ? tokens.napBg : b.kind === 'recess' ? tokens.recessBg : tokens.fill,
                    border: `1px dashed ${tokens.line}`,
                    px: 0.75,
                    display: 'flex',
                    alignItems: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <Typography noWrap sx={{ fontSize: 11, color: tokens.inkMuted, fontStyle: 'italic' }}>
                    {y(toMin(b.end)) - y(toMin(b.start)) >= 20 ? `${hhmm(b.start)} ${b.label}` : b.label}
                  </Typography>
                </Box>
              ))}
            {blocks
              .filter((b) => b.weekday === d)
              .map((b) => {
                const top = y(toMin(b.start))
                const h = Math.max(22, y(toMin(b.end)) - top - 3)
                return (
                  <ButtonBase
                    key={b.key}
                    onClick={(e) => {
                      e.stopPropagation()
                      b.onClick?.()
                    }}
                    disabled={!b.onClick}
                    aria-label={`${b.title} ${hhmm(b.start)}–${hhmm(b.end)} ${(b.lines ?? []).join(' ')}`}
                    title={[b.title, `${hhmm(b.start)}–${hhmm(b.end)}`, ...(b.lines ?? [])].join(' · ')}
                    sx={{
                      position: 'absolute',
                      top,
                      height: h,
                      insetInline: 4,
                      borderRadius: '10px',
                      bgcolor: b.color.bg,
                      color: b.color.ink,
                      p: 0.75,
                      display: 'block',
                      textAlign: 'start',
                      overflow: 'hidden',
                      opacity: b.strike ? 0.55 : 1,
                      outline: b.badge ? `2px solid ${tokens.warnLine}` : 'none',
                    }}
                  >
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'baseline' }}>
                      <Typography dir="ltr" sx={{ fontSize: 11, fontWeight: 600, opacity: 0.8, whiteSpace: 'nowrap' }}>
                        {hhmm(b.start)}–{hhmm(b.end)}
                      </Typography>
                      <Typography
                        noWrap
                        sx={{ fontSize: 12.5, fontWeight: 600, textDecoration: b.strike ? 'line-through' : 'none' }}
                      >
                        {b.title}
                      </Typography>
                    </Stack>
                    {b.badge && <Typography sx={{ fontSize: 11, fontWeight: 700, color: tokens.warnInk }}>{b.badge}</Typography>}
                    {(b.lines ?? []).slice(0, Math.max(0, Math.floor((h - 22) / 16))).map((l, i) => (
                      <Typography key={i} noWrap sx={{ fontSize: 11.5, opacity: 0.85 }}>
                        {l}
                      </Typography>
                    ))}
                  </ButtonBase>
                )
              })}
          </Box>
        ))}
      </Box>
      {blocks.length === 0 && emptyText && (
        <Typography sx={{ p: 2, textAlign: 'center', color: tokens.inkMuted }}>{emptyText}</Typography>
      )}
    </Paper>
  )
}
