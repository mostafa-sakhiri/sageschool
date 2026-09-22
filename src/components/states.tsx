import { Alert, Box, Button, CircularProgress, Paper, Skeleton, Stack, Typography } from '@mui/material'
import InboxOutlined from '@mui/icons-material/InboxOutlined'
import { Link } from '@tanstack/react-router'
import { useT } from '#/i18n/i18n'
import { errorMessage } from '#/lib/errors'
import { tokens } from '#/theme/theme'

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <Stack spacing={1.2} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={44} />
      ))}
    </Stack>
  )
}

export function FullPageLoading() {
  return (
    <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress aria-label="…" />
    </Box>
  )
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 4, textAlign: 'center', bgcolor: tokens.cardWarm, borderStyle: 'dashed' }}
    >
      <InboxOutlined sx={{ color: tokens.inkMuted, fontSize: 32 }} />
      <Typography variant="h5" sx={{ mt: 1 }}>
        {title}
      </Typography>
      {hint && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {hint}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Paper>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT()
  return (
    <Alert
      severity="error"
      sx={{ m: 2 }}
      action={
        onRetry && (
          <Button color="inherit" size="small" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )
      }
    >
      {errorMessage(error, t)}
    </Alert>
  )
}

export function NotFound() {
  const t = useT()
  return (
    <Box sx={{ p: 6, textAlign: 'center' }}>
      <Typography variant="h2">{t('common.notFound')}</Typography>
      <Button component={Link} to="/" sx={{ mt: 2 }} variant="contained">
        {t('common.backHome')}
      </Button>
    </Box>
  )
}

// Renders loading / error / empty for a query, then the content.
export function QueryState<T>({
  query,
  empty,
  children,
  rows,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown }
  empty?: (data: T) => React.ReactNode | null
  children: (data: T) => React.ReactNode
  rows?: number
}) {
  if (query.isPending) return <Loading rows={rows} />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />
  const data = query.data as T
  const e = empty?.(data)
  if (e) return <>{e}</>
  return <>{children(data)}</>
}
