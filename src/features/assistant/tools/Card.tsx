import { useRef, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import NorthEastOutlined from '@mui/icons-material/NorthEastOutlined'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import DoNotDisturbOnOutlined from '@mui/icons-material/DoNotDisturbOnOutlined'
import { SurfaceContext } from '#/components/Surface'
import { useI18n } from '#/i18n/i18n'
import { tokens } from '#/theme/theme'

// Building blocks of the assistant's cards.

// What a card tells the agent when the person is done with it
export type CardResult = { status: 'saved' | 'cancelled'; [k: string]: unknown }

// A human-in-the-loop answer is sent once: saving then closing a form must
// not report "cancelled" after "saved".
export function useSettle(respond: ((r: unknown) => Promise<void>) | undefined) {
  const done = useRef(false)
  return (r: CardResult) => {
    if (done.current || !respond) return
    done.current = true
    void respond(r)
  }
}

export function parseResult<T = CardResult>(result: string | undefined): T | null {
  if (!result) return null
  try {
    return JSON.parse(result) as T
  } catch {
    return null
  }
}

// The app's own form, drawn inline in the chat
export function FormCard({ notes, children }: { notes?: ReactNode[]; children: ReactNode }) {
  const shown = (notes ?? []).filter(Boolean)
  return (
    <Stack spacing={1}>
      {shown.map((n, i) => (
        <Alert key={i} severity="warning" sx={{ py: 0 }}>
          {n}
        </Alert>
      ))}
      <SurfaceContext.Provider value="card">{children}</SurfaceContext.Provider>
    </Stack>
  )
}

export function PendingCard({ label }: { label: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1.5, borderRadius: 3, border: `1px dashed ${tokens.lineStrong}`, color: tokens.inkMuted }}>
      <CircularProgress size={14} />
      <Typography sx={{ fontSize: 13 }}>{label}</Typography>
    </Stack>
  )
}

// A card once answered: one line, and optionally a link to what was created
export function DoneCard({ ok, label, action }: { ok: boolean; label: string; action?: ReactNode }) {
  const { t } = useI18n()
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'center',
        px: 1.5,
        py: 1,
        borderRadius: 3,
        bgcolor: ok ? tokens.accentSoft : tokens.fill,
        color: ok ? tokens.accentDark : tokens.inkMuted,
      }}
    >
      {ok ? <CheckCircleOutlined sx={{ fontSize: 18 }} /> : <DoNotDisturbOnOutlined sx={{ fontSize: 18 }} />}
      <Typography dir="auto" sx={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
        {ok ? label : t('assistant.cancelled')}
      </Typography>
      {ok && action && <Box>{action}</Box>}
    </Stack>
  )
}

// "Ouvrir": goes to the page of what the card created; the chat stays open
export function OpenButton({ to, search }: { to: string; search?: Record<string, string> }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  return (
    <Button size="small" endIcon={<NorthEastOutlined sx={{ fontSize: 14 }} />} onClick={() => navigate({ to, search } as never)}>
      {t('assistant.open')}
    </Button>
  )
}
