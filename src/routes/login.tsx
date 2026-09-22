import { useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Alert, Button, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { supabase } from '#/lib/supabase/client'
import { errorMessage } from '#/lib/errors'
import { useI18n } from '#/i18n/i18n'
import { OnboardingShell } from '#/components/OnboardingShell'
import { tokens } from '#/theme/theme'

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof s.redirect === 'string' ? s.redirect : undefined,
  }),
  component: LoginPage,
})

function LoginPage() {
  const { t, locale } = useI18n()
  const { redirect } = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName, locale } },
          })
    setBusy(false)
    if (res.error) return setError(res.error)
    await router.invalidate()
    // Only same-origin paths are honoured as redirect targets.
    const target = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
    navigate({ to: target })
  }

  return (
    <OnboardingShell>
      <Typography variant="h1" sx={{ mb: 1 }}>
        {mode === 'signin' ? t('auth.welcome') : t('auth.createTitle')}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {mode === 'signin' ? t('auth.welcomeHint') : t('auth.createHint')}
      </Typography>
      <Paper variant="outlined" sx={{ p: 3, borderColor: tokens.lineSoft }}>
        <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ mb: 2 }}>
          <Tab value="signin" label={t('auth.signIn')} />
          <Tab value="signup" label={t('auth.signUp')} />
        </Tabs>
        <Stack component="form" spacing={2} onSubmit={submit} noValidate>
          {mode === 'signup' && (
            <TextField
              label={t('auth.fullName')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              autoComplete="name"
            />
          )}
          <TextField
            label={t('auth.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            slotProps={{ htmlInput: { dir: 'ltr' } }}
          />
          <TextField
            label={t('auth.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            slotProps={{ htmlInput: { dir: 'ltr' } }}
          />
          {!!error && <Alert severity="error">{errorMessage(error, t)}</Alert>}
          <Button
            type="submit"
            variant="contained"
            size="large"
            loading={busy}
            disabled={!email || !password || (mode === 'signup' && !fullName)}
          >
            {mode === 'signin' ? t('auth.signIn') : t('auth.signUp')}
          </Button>
        </Stack>
      </Paper>
    </OnboardingShell>
  )
}
