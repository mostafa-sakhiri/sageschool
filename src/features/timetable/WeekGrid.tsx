import { Box, ButtonBase, Paper, Stack, Typography } from '@mui/material'
import { tokens } from '#/theme/theme'
import { hhmm } from '#/lib/format'

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

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Proportional week grid (mockup "La semaine d'une classe"): one column per
// school day, blocks sized by duration. Scrolls horizontally on phones.
export function WeekGrid({
  days,
  dayLabels,
  blocks,
  dayStart = '08:00',
  dayEnd = '17:00',
  dayNotes,
  emptyText,
}: {
  days: number[]
  dayLabels: Record<number, string>
  blocks: Block[]
  dayStart?: string
  dayEnd?: string
  dayNotes?: Record<number, string | undefined>
  emptyText?: string
}) {
  const earliest = Math.min(toMin(dayStart), ...blocks.map((b) => toMin(b.start)))
  const latest = Math.max(toMin(dayEnd), ...blocks.map((b) => toMin(b.end)))
  const scale = 1.1 // px per minute
  const height = (latest - earliest) * scale
  const hours: number[] = []
  for (let m = Math.ceil(earliest / 60) * 60; m <= latest; m += 60) hours.push(m)

  return (
    <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `52px repeat(${days.length}, minmax(130px, 1fr))`, minWidth: 52 + days.length * 130 }}>
        <Box />
        {days.map((d) => (
          <Box key={d} sx={{ p: 1.25, borderBottom: `1px solid ${tokens.line}`, borderInlineStart: `1px solid ${tokens.lineSoft}` }}>
            <Typography sx={{ fontWeight: 600, fontSize: 13.5 }}>{dayLabels[d]}</Typography>
            {dayNotes?.[d] && <Typography sx={{ fontSize: 11.5, color: tokens.warnInk }}>{dayNotes[d]}</Typography>}
          </Box>
        ))}
        <Box sx={{ position: 'relative', height }}>
          {hours.map((m) => (
            <Typography
              key={m}
              sx={{ position: 'absolute', top: (m - earliest) * scale - 7, insetInlineEnd: 6, fontSize: 11, color: tokens.inkMuted }}
            >
              {String(Math.floor(m / 60)).padStart(2, '0')}:00
            </Typography>
          ))}
        </Box>
        {days.map((d) => (
          <Box key={d} sx={{ position: 'relative', height, borderInlineStart: `1px solid ${tokens.lineSoft}` }}>
            {hours.map((m) => (
              <Box key={m} sx={{ position: 'absolute', insetInline: 0, top: (m - earliest) * scale, borderTop: `1px dashed ${tokens.lineSoft}` }} />
            ))}
            {blocks
              .filter((b) => b.weekday === d)
              .map((b) => {
                const top = (toMin(b.start) - earliest) * scale
                const h = Math.max(22, (toMin(b.end) - toMin(b.start)) * scale - 3)
                return (
                  <ButtonBase
                    key={b.key}
                    onClick={b.onClick}
                    disabled={!b.onClick}
                    aria-label={`${b.title} ${hhmm(b.start)}–${hhmm(b.end)} ${(b.lines ?? []).join(' ')}`}
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
                      <Typography sx={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>{hhmm(b.start)}</Typography>
                      <Typography
                        noWrap
                        sx={{ fontSize: 12.5, fontWeight: 600, textDecoration: b.strike ? 'line-through' : 'none' }}
                      >
                        {b.title}
                      </Typography>
                    </Stack>
                    {b.badge && <Typography sx={{ fontSize: 11, fontWeight: 700, color: tokens.warnInk }}>{b.badge}</Typography>}
                    {(b.lines ?? []).map((l, i) => (
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
