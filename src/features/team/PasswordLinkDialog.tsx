import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import { createPasswordLink } from '#/lib/members'
import { useI18n } from '#/i18n/i18n'
import { useSchool } from '#/lib/session'
import { errorMessage } from '#/lib/errors'
import { WhatsAppButton } from '#/components/WhatsApp'
import { tokens } from '#/theme/theme'

export type PasswordLinkTarget = { memberId: string; fullName: string; phone: string | null }

// A one-time link to choose a new password, for the office to hand over
// (copy it, or send it on WhatsApp). Created as soon as the dialog opens.
export function PasswordLinkDialog({ target, onClose }: { target: PasswordLinkTarget; onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const [copied, setCopied] = useState(false)
  const create = useMutation({ mutationFn: () => createPasswordLink({ data: { schoolId: ctx.school.id, memberId: target.memberId } }) })
  const { mutate } = create
  useEffect(() => mutate(), [mutate])
  const url = create.data?.url

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('reset.linkTitle', { name: target.fullName })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t('reset.linkHint')}
          </Typography>
          {create.isPending && (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <CircularProgress size={16} />
              <Typography variant="body2">{t('reset.creating')}</Typography>
            </Stack>
          )}
          {create.isError && <Alert severity="error">{errorMessage(create.error, t)}</Alert>}
          {url && (
            <>
              <Typography
                dir="ltr"
                sx={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12.5, p: 1.5, bgcolor: tokens.fill, borderRadius: 2, wordBreak: 'break-all', userSelect: 'all' }}
              >
                {url}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  startIcon={<ContentCopyOutlined />}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url)
                      setCopied(true)
                    } catch {
                      /* clipboard refused: the link stays selectable */
                    }
                  }}
                >
                  {copied ? t('reset.copied') : t('reset.copy')}
                </Button>
                <WhatsAppButton phone={target.phone} label={t('reset.sendWhatsApp')} text={t('reset.whatsApp', { name: target.fullName, school: ctx.school.name, url })} />
              </Stack>
              <Alert severity="info" icon={false}>
                {t('reset.validity')}
              </Alert>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
