import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Stack, Tooltip } from '@mui/material'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import PhoneInTalkOutlined from '@mui/icons-material/PhoneInTalkOutlined'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import { formatDate, formatDateTime } from '#/lib/format'
import { WhatsAppParents, type WaRecipient } from '#/components/WhatsApp'
import { tokens } from '#/theme/theme'

// On an absence or lateness: has the family been told? One click turns it
// green (who, when); clicking the green chip undoes it. With the parents'
// phones, a WhatsApp button writes the message and marks them as notified.
export function ParentNotified({
  recordId,
  notifiedAt,
  parents,
  child,
  date,
  status,
}: {
  recordId: string
  notifiedAt: string | null
  parents?: WaRecipient[]
  child?: string
  date?: string
  status?: string
}) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const set = useMutation({
    mutationFn: async (on: boolean) =>
      must(
        await supabase
          .from('attendance_records')
          .update(on ? { parent_notified_at: new Date().toISOString(), parent_notified_by_member_id: ctx.member.id } : { parent_notified_at: null, parent_notified_by_member_id: null })
          .eq('id', recordId),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] }),
  })
  const whatsapp = parents && child && (
    <WhatsAppParents
      parents={parents}
      text={(name) =>
        t(status === 'late' ? 'wa.late' : 'wa.absence', { parent: name, child, date: formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' }), school: ctx.school.name })
      }
      onSent={() => !notifiedAt && set.mutate(true)}
    />
  )
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', display: 'inline-flex' }}>
      {whatsapp}
      {notifiedAt ? (
        <Tooltip title={`${t('att.notifiedAt', { at: formatDateTime(notifiedAt, locale) })} — ${t('att.clickToUndo')}`}>
          <Button
            size="small"
            startIcon={<CheckCircleOutlined />}
            onClick={() => set.mutate(false)}
            loading={set.isPending}
            sx={{ bgcolor: tokens.accentSoft, color: tokens.accentDark, border: `1px solid ${tokens.accentLine}`, '&:hover': { bgcolor: tokens.accentSoft } }}
          >
            {t('att.parentNotified')}
          </Button>
        </Tooltip>
      ) : (
        <Button size="small" variant="outlined" startIcon={<PhoneInTalkOutlined />} onClick={() => set.mutate(true)} loading={set.isPending}>
          {t('att.markNotified')}
        </Button>
      )}
    </Stack>
  )
}
