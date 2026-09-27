import { Box, Stack, Typography } from '@mui/material'
import { tokens } from '#/theme/theme'
import { toMin } from '#/features/setup/schedule'
import type { Band } from './WeekGrid'

// A small week grid for the assistant's cards: only the days a change
// touches, the sessions after the change, where they came from, and what
// blocks them.
export type MiniBlock = {
  key: string
  weekday: number
  start: string
  end: string
  title: string
  sub?: string
  color: { bg: string; ink: string }
  // new: placed by this change · ghost: where it was · conflict: in the way
  // · busy: the teacher's session in another class
  state: 'normal' | 'new' | 'ghost' | 'conflict' | 'busy'
}

const PX = 0.62 // pixels per minute

export function MiniWeek({
  days,
  labels,
  dayStart,
  dayEnd,
  blocks,
  bands,
}: {
  days: number[]
  labels: Record<number, string>
  dayStart: string
  dayEnd: string
  blocks: MiniBlock[]
  bands: Band[]
}) {
  const from = toMin(dayStart)
  const to = toMin(dayEnd)
  const height = Math.max(60, (to - from) * PX)
  const hours: number[] = []
  for (let h = Math.ceil(from / 60) * 60; h <= to; h += 60) hours.push(h)
  const y = (t: string) => (toMin(t) - from) * PX

  return (
    <Box sx={{ border: `1px solid ${tokens.line}`, borderRadius: 2, bgcolor: tokens.content, overflow: 'hidden' }}>
      <Stack direction="row" sx={{ borderBottom: `1px solid ${tokens.line}` }}>
        <Box sx={{ width: 34, flexShrink: 0 }} />
        {days.map((d) => (
          <Typography key={d} sx={{ flex: 1, textAlign: 'center', fontSize: 11.5, fontWeight: 600, py: 0.5, color: tokens.inkSoft }}>
            {labels[d]}
          </Typography>
        ))}
      </Stack>
      <Stack direction="row" sx={{ position: 'relative', height }}>
        <Box sx={{ width: 34, flexShrink: 0, position: 'relative' }}>
          {hours.map((h) => (
            <Typography key={h} dir="ltr" sx={{ position: 'absolute', top: (h - from) * PX - 6, insetInlineEnd: 4, fontSize: 9.5, color: tokens.inkMuted }}>
              {String(h / 60).padStart(2, '0')}h
            </Typography>
          ))}
        </Box>
        {days.map((d) => (
          <Box key={d} sx={{ flex: 1, position: 'relative', borderInlineStart: `1px solid ${tokens.lineSoft}` }}>
            {hours.map((h) => (
              <Box key={h} sx={{ position: 'absolute', insetInline: 0, top: (h - from) * PX, borderTop: `1px dashed ${tokens.lineSoft}` }} />
            ))}
            {bands
              .filter((b) => b.weekday === d)
              .map((b, i) => (
                <Box
                  key={i}
                  title={b.label}
                  sx={{ position: 'absolute', insetInline: 0, top: y(b.start), height: (toMin(b.end) - toMin(b.start)) * PX, bgcolor: b.kind === 'nap' ? tokens.napBg : tokens.recessBg, opacity: 0.8 }}
                />
              ))}
            {blocks
              .filter((b) => b.weekday === d)
              .map((b) => {
                const bad = b.state === 'conflict' || b.state === 'busy'
                return (
                  <Box
                    key={b.key}
                    title={`${b.title} ${b.start}–${b.end}${b.sub ? ` · ${b.sub}` : ''}`}
                    sx={{
                      position: 'absolute',
                      insetInlineStart: b.state === 'busy' ? '50%' : 2,
                      insetInlineEnd: 2,
                      top: y(b.start) + 1,
                      height: Math.max(12, (toMin(b.end) - toMin(b.start)) * PX - 2),
                      px: 0.5,
                      borderRadius: '5px',
                      overflow: 'hidden',
                      fontSize: 10,
                      lineHeight: 1.25,
                      bgcolor: b.state === 'ghost' ? 'transparent' : bad ? tokens.dangerSoft : b.color.bg,
                      color: bad ? tokens.dangerInk : b.color.ink,
                      border:
                        b.state === 'ghost'
                          ? `1.5px dashed ${tokens.lineStrong}`
                          : bad
                            ? `1.5px solid ${tokens.dangerInk}`
                            : b.state === 'new'
                              ? `2px solid ${tokens.accent}`
                              : `1px solid transparent`,
                      boxShadow: b.state === 'new' ? `0 0 0 3px ${tokens.accentSoft}` : 'none',
                      opacity: b.state === 'ghost' ? 0.7 : 1,
                      backgroundImage: b.state === 'busy' ? `repeating-linear-gradient(45deg, transparent 0 4px, ${tokens.dangerLine} 4px 6px)` : 'none',
                      zIndex: b.state === 'normal' ? 1 : 2,
                    }}
                  >
                    <Box component="span" sx={{ fontWeight: 600, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: b.state === 'ghost' ? tokens.inkMuted : undefined }}>
                      {b.title}
                    </Box>
                    {b.sub && (
                      <Box component="span" sx={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.85 }}>
                        {b.sub}
                      </Box>
                    )}
                  </Box>
                )
              })}
          </Box>
        ))}
      </Stack>
    </Box>
  )
}
