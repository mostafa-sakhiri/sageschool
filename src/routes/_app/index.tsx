import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '#/components/AppShell'
import { PageIntro } from '#/components/ui'
import { useSchool } from '#/lib/session'
import { useT } from '#/i18n/i18n'

export const Route = createFileRoute('/_app/')({ component: Dashboard })

function Dashboard() {
  const t = useT()
  const ctx = useSchool()
  return (
    <AppShell title={t('nav.dashboard')}>
      <PageIntro title={t('dash.hello', { name: ctx.user.full_name.split(' ')[0] })} />
    </AppShell>
  )
}
