import { createFileRoute } from '@tanstack/react-router'
import { OnboardingShell } from '#/components/OnboardingShell'

export const Route = createFileRoute('/_app/setup')({ component: Setup })

function Setup() {
  return <OnboardingShell>setup</OnboardingShell>
}
