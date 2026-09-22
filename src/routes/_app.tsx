import { useMemo } from 'react'
import { Navigate, Outlet, createFileRoute, redirect, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchClaims } from '#/lib/auth'
import {
  SchoolContext,
  currentYearQuery,
  resolveActive,
  sessionQuery,
  useSelectionVersion,
  type SchoolCtx,
} from '#/lib/session'
import { ErrorState, FullPageLoading } from '#/components/states'
import { OnboardingShell } from '#/components/OnboardingShell'
import { useT } from '#/i18n/i18n'
import { Typography } from '@mui/material'

// Protected layout. beforeLoad only gates rendering; every privileged read or
// write is enforced again by RLS (browser client) or by getClaims() inside the
// server function that performs it.
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location, context }) => {
    const claims = await fetchClaims()
    if (!claims) throw redirect({ to: '/login', search: { redirect: location.href } })
    // Resolve the active school up-front so child loaders can prefetch its data.
    const session = await context.queryClient.ensureQueryData(sessionQuery(claims.sub))
    const active = session ? resolveActive(session) : null
    return { claims, schoolId: active?.school?.id ?? null, role: active?.member?.role ?? null }
  },
  pendingComponent: FullPageLoading,
  component: AppLayout,
})

function AppLayout() {
  const { claims } = Route.useRouteContext()
  const t = useT()
  const session = useQuery(sessionQuery(claims.sub))
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const selection = useSelectionVersion()
  const active = useMemo(
    () => (session.data ? resolveActive(session.data) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection: localStorage changed
    [session.data, selection],
  )
  const year = useQuery({
    ...currentYearQuery(active?.school?.id ?? ''),
    enabled: !!active?.school,
  })

  if (session.isPending) return <FullPageLoading />
  if (session.isError) return <ErrorState error={session.error} onRetry={() => session.refetch()} />
  if (!session.data || !active) {
    return (
      <OnboardingShell>
        <Typography>{t('errors.noProfile')}</Typography>
      </OnboardingShell>
    )
  }

  // No school yet: the founder goes through the installation wizard.
  if (!active.school) {
    if (pathname !== '/setup') return <Navigate to="/setup" />
    return <Outlet />
  }
  if (year.isPending && active.school) return <FullPageLoading />

  const ctx: SchoolCtx = {
    sub: claims.sub,
    user: session.data.user,
    schools: active.schools,
    school: active.school,
    member: active.member!,
    role: active.member!.role,
    roles: active.roles,
    year: year.data ?? null,
    isOffice: active.member!.role === 'admin' || active.member!.role === 'staff',
    isAdmin: active.member!.role === 'admin',
  }
  return (
    <SchoolContext.Provider value={ctx}>
      <Outlet />
    </SchoolContext.Provider>
  )
}
