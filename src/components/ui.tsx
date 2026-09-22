import { Box, Chip, Paper, Stack, Typography, type ChipProps } from '@mui/material'
import { tokens } from '#/theme/theme'

// Section heading in the mockups' style: small caps label + rule + aside.
export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mt: 3.25, mb: 1.5 }}>
      <Typography
        component="h2"
        sx={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: tokens.inkMuted }}
      >
        {children}
      </Typography>
      <Box sx={{ flex: 1, height: '1px', bgcolor: tokens.line }} />
      {aside}
    </Stack>
  )
}

export function PageIntro({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ alignItems: { xs: 'stretch', sm: 'flex-end' }, justifyContent: 'space-between', mb: 2.5 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h2" component="h2">
          {title}
        </Typography>
        {subtitle && (
          <Typography sx={{ mt: 0.75, color: tokens.inkSoft, fontSize: 14.5 }}>{subtitle}</Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {actions}
        </Stack>
      )}
    </Stack>
  )
}

export function StatCard({ value, label, hint }: { value: React.ReactNode; label: string; hint?: string }) {
  return (
    <Paper variant="outlined" sx={{ flex: '1 1 160px', p: 2, minWidth: 0 }}>
      <Typography sx={{ fontFamily: tokens.display, fontSize: 28, lineHeight: 1 }}>{value}</Typography>
      <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted, mt: 0.75 }}>{label}</Typography>
      {hint && <Typography sx={{ fontSize: 12, color: tokens.inkMuted }}>{hint}</Typography>}
    </Paper>
  )
}

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info'
const TONES: Record<Tone, { bg: string; bd: string; ink: string }> = {
  ok: { bg: tokens.accentSoft, bd: tokens.accentLine, ink: tokens.accentDark },
  warn: { bg: tokens.warnSoft, bd: tokens.warnLine, ink: tokens.warnInk },
  danger: { bg: tokens.dangerSoft, bd: '#E8B9B0', ink: tokens.dangerInk },
  neutral: { bg: '#FFFFFF', bd: tokens.lineStrong, ink: tokens.inkMuted },
  info: { bg: '#F0EAF7', bd: '#DFD3EC', ink: '#57407A' },
}

export function Tag({ tone = 'neutral', ...props }: ChipProps & { tone?: Tone }) {
  const c = TONES[tone]
  return (
    <Chip
      size="small"
      {...props}
      sx={{ bgcolor: c.bg, border: `1px solid ${c.bd}`, color: c.ink, height: 22, fontSize: 11.5, ...props.sx }}
    />
  )
}

export function Card({ children, sx }: { children: React.ReactNode; sx?: object }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, ...sx }}>
      {children}
    </Paper>
  )
}

export function fullName(p: { first_name: string; last_name: string } | null | undefined) {
  return p ? `${p.first_name} ${p.last_name}` : ''
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
