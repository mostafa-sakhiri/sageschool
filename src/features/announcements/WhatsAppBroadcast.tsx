import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import ContactsOutlined from '@mui/icons-material/ContactsOutlined'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatPhone, normalizePhone } from '#/lib/format'
import { openWhatsApp, waLink } from '#/components/WhatsApp'
import type { Announcement } from '#/features/queries'
import { tokens } from '#/theme/theme'

type Recipient = {
  id: string
  status: 'stubbed' | 'sent' | 'failed'
  sent_at: string | null
  user: { full_name: string; phone: string | null } | null
}

export const broadcastQuery = (schoolId: string, announcementId: string) => ({
  queryKey: ['school', schoolId, 'broadcast', announcementId],
  queryFn: async () =>
    (
      must(
        await supabase
          .from('notification_outbox')
          .select('id, status, sent_at, user:users(full_name, phone)')
          .eq('kind', 'announcement')
          .eq('ref_id', announcementId),
      ) as unknown as Recipient[]
    ).sort((a, b) => (a.user?.full_name ?? '').localeCompare(b.user?.full_name ?? '')),
})

const firstName = (full: string) => full.split(/\s+/)[0] ?? full

// Sending an announcement to every parent it reaches, through WhatsApp links:
// "Envoyer au suivant" opens the next parent's chat with the message written
// and ticks them as sent (one outbox row per parent, created at publication).
// For large schools: copy the message and export the contacts to a WhatsApp
// broadcast list instead.
export function WhatsAppBroadcast({ announcement, onClose }: { announcement: Announcement; onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const recipients = useQuery(broadcastQuery(ctx.school.id, announcement.id))
  const [message, setMessage] = useState(t('wa.announcement', { school: ctx.school.name, title: announcement.title, body: announcement.body }))
  const [greet, setGreet] = useState(true)
  const [filter, setFilter] = useState<'todo' | 'all'>('todo')
  const [copied, setCopied] = useState(false)

  const mark = useMutation({
    mutationFn: async ({ id, sent }: { id: string; sent: boolean }) =>
      must(await supabase.from('notification_outbox').update({ status: sent ? 'sent' : 'stubbed' }).eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'broadcast', announcement.id] }),
  })

  const rows = recipients.data ?? []
  const reachable = rows.filter((r) => waLink(r.user?.phone, 'x'))
  const sent = rows.filter((r) => r.status === 'sent').length
  const next = reachable.find((r) => r.status !== 'sent')
  const textFor = (r: Recipient) => (greet && r.user ? `${t('wa.greet', { name: firstName(r.user.full_name) })} ${message}` : message)
  const send = (r: Recipient) => {
    if (openWhatsApp(r.user?.phone, textFor(r)) && r.status !== 'sent') mark.mutate({ id: r.id, sent: true })
  }
  const shown = useMemo(() => (filter === 'todo' ? rows.filter((r) => r.status !== 'sent') : rows), [rows, filter])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard refused: the message stays selectable in the field */
    }
  }
  // vCard file: import into the phone, then build a WhatsApp broadcast list
  const exportContacts = () => {
    const cards = reachable
      .map((r) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${r.user!.full_name}\r\nTEL;TYPE=CELL:${normalizePhone(r.user!.phone)}\r\nNOTE:${ctx.school.name}\r\nEND:VCARD`)
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([cards], { type: 'text/vcard' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `parents-${announcement.title.slice(0, 30).replace(/[^\p{L}\p{N}]+/gu, '-')}.vcf`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('bc.title', { title: announcement.title })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box>
            <Stack direction="row" sx={{ alignItems: 'baseline', mb: 0.75 }}>
              <Typography sx={{ fontWeight: 600, flex: 1 }}>{t('bc.progress', { sent, total: rows.length })}</Typography>
              {rows.length - reachable.length > 0 && (
                <Typography sx={{ fontSize: 13, color: tokens.warnInk }}>{t('bc.noPhone', { n: rows.length - reachable.length })}</Typography>
              )}
            </Stack>
            <LinearProgress variant="determinate" value={rows.length ? (sent / rows.length) * 100 : 0} sx={{ height: 6, borderRadius: 3 }} />
          </Box>

          <TextField label={t('bc.message')} value={message} onChange={(e) => setMessage(e.target.value)} multiline minRows={3} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
            <Stack direction="row" sx={{ alignItems: 'center', flex: 1 }}>
              <Checkbox checked={greet} onChange={(e) => setGreet(e.target.checked)} size="small" />
              <Typography sx={{ fontSize: 14 }}>{t('bc.greet')}</Typography>
            </Stack>
            <Button size="small" startIcon={<ContentCopyOutlined />} onClick={copy}>
              {copied ? t('bc.copied') : t('bc.copy')}
            </Button>
            <Tooltip title={t('bc.exportHint')}>
              <span>
                <Button size="small" startIcon={<ContactsOutlined />} onClick={exportContacts} disabled={!reachable.length}>
                  {t('bc.export')}
                </Button>
              </span>
            </Tooltip>
          </Stack>

          {recipients.isPending ? (
            <LinearProgress />
          ) : rows.length === 0 ? (
            <Alert severity="warning">{t('bc.none')}</Alert>
          ) : (
            <>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: next ? tokens.accentSoft : tokens.fill,
                  border: `1px solid ${next ? tokens.accentLine : tokens.line}`,
                  display: 'flex',
                  gap: 2,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  {next ? (
                    <>
                      <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{t('bc.next')}</Typography>
                      <Typography sx={{ fontWeight: 600 }}>
                        {next.user?.full_name}{' '}
                        <Box component="span" dir="ltr" sx={{ color: tokens.inkMuted, fontWeight: 400 }}>
                          {formatPhone(normalizePhone(next.user?.phone))}
                        </Box>
                      </Typography>
                    </>
                  ) : (
                    <Typography sx={{ fontWeight: 600 }}>{t('bc.done')}</Typography>
                  )}
                </Box>
                {next && (
                  <Button variant="contained" size="large" startIcon={<WhatsAppIcon />} onClick={() => send(next)} sx={{ bgcolor: '#25D366', color: '#0b2e17', '&:hover': { bgcolor: '#1fbd5a' } }}>
                    {t('bc.sendNext')}
                  </Button>
                )}
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t('bc.how')}
              </Typography>

              <Stack direction="row" sx={{ alignItems: 'center' }}>
                <Typography variant="h6" sx={{ flex: 1 }}>
                  {t('bc.parents')}
                </Typography>
                <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, v) => v && setFilter(v)}>
                  <ToggleButton value="todo">{t('bc.todo', { n: rows.length - sent })}</ToggleButton>
                  <ToggleButton value="all">{t('common.all')}</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              <Box sx={{ maxHeight: 320, overflow: 'auto', border: `1px solid ${tokens.line}`, borderRadius: 2 }}>
                {shown.map((r) => {
                  const ok = !!waLink(r.user?.phone, 'x')
                  return (
                    <Stack key={r.id} direction="row" spacing={1} sx={{ alignItems: 'center', px: 1.5, py: 0.75, borderBottom: `1px solid ${tokens.lineSoft}` }}>
                      <Tooltip title={r.status === 'sent' ? t('bc.unmark') : t('bc.markSent')}>
                        <Checkbox
                          size="small"
                          checked={r.status === 'sent'}
                          onChange={(e) => mark.mutate({ id: r.id, sent: e.target.checked })}
                          slotProps={{ input: { 'aria-label': `${t('bc.markSent')} — ${r.user?.full_name ?? ''}` } }}
                        />
                      </Tooltip>
                      <Typography sx={{ flex: 1, fontSize: 14, color: r.status === 'sent' ? tokens.inkMuted : tokens.ink }}>{r.user?.full_name}</Typography>
                      <Typography dir="ltr" sx={{ fontSize: 13, color: ok ? tokens.inkMuted : tokens.warnInk }}>
                        {ok ? formatPhone(normalizePhone(r.user?.phone)) : t('wa.noPhone')}
                      </Typography>
                      <Button size="small" startIcon={<WhatsAppIcon sx={{ color: '#25D366' }} />} disabled={!ok} onClick={() => send(r)}>
                        {r.status === 'sent' ? t('bc.resend') : t('bc.send')}
                      </Button>
                    </Stack>
                  )
                })}
                {shown.length === 0 && <Typography sx={{ p: 2, color: tokens.inkMuted }}>{t('bc.allSent')}</Typography>}
              </Box>
            </>
          )}
          {mark.isError && <Alert severity="error">{errorMessage(mark.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
