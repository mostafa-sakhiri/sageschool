import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Alert, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { supabase } from '#/lib/supabase/client'
import { errorMessage } from '#/lib/errors'
import { useI18n } from '#/i18n/i18n'
import { OnboardingShell } from '#/components/OnboardingShell'

// Choose a new password. Two ways in:
// - a link handed over by the office (?token_hash=…, one-time, see
//   createPasswordLink): the token opens a session, then the new password;
// - signed in, from the account menu: the new password directly.
export const Route = createFileRoute('/reset-password')({
  validateSearch: (s: Record<string, unknown>): { token_hash?: string } => ({
    token_hash: typeof s.token_hash === 'string' ? s.token_hash : undefined,
  }),
  component: ResetPasswordPage,
})

type Step = 'checking' | 'ready' | 'invalid' | 'done'

function ResetPasswordPage() {
  const { t } = useI18n()
  const { token_hash } = Route.useSearch()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  // A token works once: the dev double effect must not spend it twice
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      if (token_hash) {
        const { error: e } = await supabase.auth.verifyOtp({ token_hash, type: 'recovery' })
        // The token is spent: keep it out of the address bar and history
        navigate({ to: '/reset-password', search: {}, replace: true })
        setStep(e ? 'invalid' : 'ready')
        return
      }
      const { data } = await supabase.auth.getSession()
      setStep(data.session ? 'ready' : 'invalid')
    })()
  }, [token_hash, navigate])

  const tooShort = password.length > 0 && password.length < 8
  const mismatch = confirm.length > 0 && confirm !== password

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) setError(err)
    else setStep('done')
  }

  return (
    <OnboardingShell>
      <Paper variant="outlined" sx={{ maxWidth: 420, mx: 'auto', mt: { xs: 4, md: 8 }, p: { xs: 3, md: 4 } }}>
        <Typography variant="h3" sx={{ mb: 1 }}>
          {t('reset.title')}
        </Typography>
        {step === 'checking' && (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 2 }}>
            <CircularProgress size={18} />
            <Typography color="text.secondary">{t('reset.checking')}</Typography>
          </Stack>
        )}
        {step === 'invalid' && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="error">{t('reset.invalid')}</Alert>
            <Button variant="outlined" onClick={() => navigate({ to: '/login', search: {} })}>
              {t('auth.signIn')}
            </Button>
          </Stack>
        )}
        {step === 'done' && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="success">{t('reset.done')}</Alert>
            <Button variant="contained" size="large" onClick={() => navigate({ to: '/' })}>
              {t('reset.continue')}
            </Button>
          </Stack>
        )}
        {step === 'ready' && (
          <Stack component="form" spacing={2} onSubmit={submit} noValidate sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('reset.hint')}
            </Typography>
            <TextField
              label={t('reset.new')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              autoComplete="new-password"
              error={tooShort}
              helperText={tooShort ? t('reset.tooShort') : undefined}
              slotProps={{ htmlInput: { dir: 'ltr', minLength: 8 } }}
            />
            <TextField
              label={t('reset.confirm')}
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              error={mismatch}
              helperText={mismatch ? t('reset.mismatch') : undefined}
              slotProps={{ htmlInput: { dir: 'ltr' } }}
            />
            {!!error && <Alert severity="error">{errorMessage(error, t)}</Alert>}
            <Button type="submit" variant="contained" size="large" loading={busy} disabled={password.length < 8 || confirm !== password}>
              {t('reset.save')}
            </Button>
          </Stack>
        )}
      </Paper>
    </OnboardingShell>
  )
}
