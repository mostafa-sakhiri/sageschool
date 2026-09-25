import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { CacheProvider } from '@emotion/react'
import { CssBaseline, InitColorSchemeScript, ThemeProvider } from '@mui/material'
import { useMemo } from 'react'
import { fetchLocale } from '#/lib/auth'
import { I18nProvider, useI18n, type Locale } from '#/i18n/i18n'
import { COLOR_SCHEME_ATTRIBUTE, createAppTheme, emotionCaches, tokenCss } from '#/theme/theme'
import { ErrorState, NotFound } from '#/components/states'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // The shell is server-rendered: the language cookie sets <html dir> from the
  // first byte.
  ssr: true,
  beforeLoad: async () => ({ initialLocale: (await fetchLocale()) as Locale }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'SageSchool' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap',
      },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  errorComponent: ({ error }) => <ErrorState error={error} />,
  notFoundComponent: () => <NotFound />,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const { initialLocale } = Route.useRouteContext()
  const locale = initialLocale ?? 'fr'
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} suppressHydrationWarning>
      <head>
        <HeadContent />
        <style dangerouslySetInnerHTML={{ __html: tokenCss }} />
      </head>
      <body style={{ margin: 0, background: 'var(--ss-paper)' }}>
        <InitColorSchemeScript attribute={COLOR_SCHEME_ATTRIBUTE} defaultMode="light" />
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  const { initialLocale } = Route.useRouteContext()
  return (
    <I18nProvider initial={initialLocale ?? 'fr'}>
      <Themed>
        <Outlet />
      </Themed>
    </I18nProvider>
  )
}

function Themed({ children }: { children: React.ReactNode }) {
  const { dir } = useI18n()
  const theme = useMemo(() => createAppTheme(dir), [dir])
  return (
    <CacheProvider value={emotionCaches[dir]}>
      <ThemeProvider theme={theme} defaultMode="light">
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  )
}
