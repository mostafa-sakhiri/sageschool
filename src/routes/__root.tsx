import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { CacheProvider } from '@emotion/react'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { useMemo } from 'react'
import { fetchLocale } from '#/lib/auth'
import { I18nProvider, useI18n, type Locale } from '#/i18n/i18n'
import { createAppTheme, emotionCaches } from '#/theme/theme'
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
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap',
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
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0, background: '#F7F4EE' }}>
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
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  )
}
