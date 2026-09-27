import { useState } from 'react'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material'
import { supabase } from '#/lib/supabase/client'
import { errorMessage } from '#/lib/errors'
import { loginIdentifier } from '#/lib/phoneLogin'
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
  const [forgot, setForgot] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email: loginIdentifier(email), password })
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
            label={mode === 'signin' ? t('auth.emailOrPhone') : t('auth.email')}
            type={mode === 'signin' ? 'text' : 'email'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete={mode === 'signin' ? 'username' : 'email'}
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
        {mode === 'signin' && (
          <Button size="small" onClick={() => setForgot(true)} sx={{ mt: 1.5, alignSelf: 'flex-start' }}>
            {t('auth.forgot')}
          </Button>
        )}
        {forgot && <ForgotPassword initial={email} onClose={() => setForgot(false)} />}
      </Paper>
    </OnboardingShell>
  )
}

// Forgotten password, for accounts with an e-mail: a link by e-mail to
// /reset-password (template supabase/templates/recovery.html). A phone-only
// account has no mailbox: the school hands over a link instead. The answer
// never says whether the address has an account.
function ForgotPassword({ initial, onClose }: { initial: string; onClose: () => void }) {
  const { t } = useI18n()
  const [value, setValue] = useState(initial.includes('@') ? initial : '')
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'phone'>('idle')
  const [error, setError] = useState<unknown>(null)
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.includes('@')) return setState('phone')
    setState('busy')
    setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(value.trim(), { redirectTo: `${window.location.origin}/reset-password` })
    // Unknown addresses are not an error (no account enumeration); rate limits are
    if (err && err.status === 429) {
      setError(err)
      setState('idle')
    } else setState('sent')
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form onSubmit={send}>
        <DialogTitle>{t('auth.forgotTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            {state === 'sent' ? (
              <Alert severity="success">{t('auth.forgotSent')}</Alert>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary">
                  {t('auth.forgotHint')}
                </Typography>
                <TextField
                  label={t('auth.emailOrPhone')}
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value)
                    if (state === 'phone') setState('idle')
                  }}
                  autoFocus
                  autoComplete="username"
                  slotProps={{ htmlInput: { dir: 'ltr' } }}
                />
                {state === 'phone' && <Alert severity="info">{t('auth.forgotPhone')}</Alert>}
                {!!error && <Alert severity="error">{errorMessage(error, t)}</Alert>}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.close')}</Button>
          {state !== 'sent' && (
            <Button type="submit" variant="contained" loading={state === 'busy'} disabled={!value.trim()}>
              {t('auth.forgotSend')}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  )
}
