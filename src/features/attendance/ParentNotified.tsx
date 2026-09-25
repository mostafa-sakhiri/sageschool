import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Tooltip } from '@mui/material'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import PhoneInTalkOutlined from '@mui/icons-material/PhoneInTalkOutlined'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import { formatDateTime } from '#/lib/format'
import { tokens } from '#/theme/theme'

// On an absence or lateness: has the family been told? One click turns it
// green (who, when); clicking the green chip undoes it.
export function ParentNotified({ recordId, notifiedAt }: { recordId: string; notifiedAt: string | null }) {
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
  if (notifiedAt)
    return (
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
    )
  return (
    <Button size="small" variant="outlined" startIcon={<PhoneInTalkOutlined />} onClick={() => set.mutate(true)} loading={set.isPending}>
      {t('att.markNotified')}
    </Button>
  )
}
