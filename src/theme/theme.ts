import { createTheme } from '@mui/material/styles'
import createCache from '@emotion/cache'
import { prefixer } from 'stylis'
import rtlPluginModule from 'stylis-plugin-rtl'

// Tokens from the mockups: warm paper ground, deep green accent, IBM Plex Sans
// body over Newsreader display.
export const tokens = {
  paper: '#F7F4EE',
  card: '#FFFFFF',
  cardWarm: '#FFFDF9',
  line: '#E4DED2',
  lineSoft: '#EFE9DE',
  lineStrong: '#D3CBBB',
  ink: '#1C1A16',
  inkSoft: '#4A463E',
  inkMuted: '#6B655A',
  accent: '#0F6B5B',
  accentDark: '#0A5347',
  accentSoft: '#E4F0EC',
  accentLine: '#BFD9D1',
  warnSoft: '#FAEFDD',
  warnLine: '#E7CFA4',
  warnInk: '#7A4709',
  dangerInk: '#A33A2C',
  dangerSoft: '#F9E6E2',
  sidebar: '#1F1D19',
  sidebarInk: '#E7E2D7',
  sidebarMuted: '#A8A093',
  display: 'Newsreader, Georgia, serif',
}

export function createAppTheme(direction: 'ltr' | 'rtl') {
  const body =
    direction === 'rtl'
      ? "'IBM Plex Sans Arabic', 'IBM Plex Sans', 'Segoe UI', sans-serif"
      : "'IBM Plex Sans', 'Segoe UI', sans-serif"
  return createTheme({
    direction,
    palette: {
      mode: 'light',
      primary: { main: tokens.accent, dark: tokens.accentDark, contrastText: '#FFFFFF' },
      secondary: { main: '#57407A' },
      warning: { main: '#9A5B12' },
      error: { main: tokens.dangerInk },
      background: { default: tokens.paper, paper: tokens.card },
      text: { primary: tokens.ink, secondary: tokens.inkMuted },
      divider: tokens.line,
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: body,
      h1: { fontFamily: tokens.display, fontWeight: 500, fontSize: '2rem' },
      h2: { fontFamily: tokens.display, fontWeight: 500, fontSize: '1.75rem' },
      h3: { fontFamily: tokens.display, fontWeight: 500, fontSize: '1.4rem' },
      h4: { fontSize: '1.125rem', fontWeight: 600 },
      h5: { fontSize: '1rem', fontWeight: 600 },
      h6: { fontSize: '0.9rem', fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
      overline: { fontWeight: 600, letterSpacing: '0.06em' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: { body: { fontFeatureSettings: "'tnum' 1" } },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 10, minHeight: 36 } },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { outlined: { borderColor: tokens.lineSoft }, rounded: { borderRadius: 16 } },
      },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: { root: { borderRadius: 16, borderColor: tokens.lineSoft } },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTableCell: {
        styleOverrides: { head: { fontWeight: 600, color: tokens.inkMuted, fontSize: '0.8rem' } },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiSelect: { defaultProps: { size: 'small' } },
    },
  })
}

// CJS/ESM interop: under SSR (Node) the default import is the module object.
const rtlPlugin = ((rtlPluginModule as unknown as { default?: unknown }).default ?? rtlPluginModule) as typeof rtlPluginModule

// One Emotion cache per direction: the RTL one flips every style (margins,
// paddings, positions) through stylis-plugin-rtl.
export const emotionCaches = {
  ltr: createCache({ key: 'mui', prepend: true }),
  rtl: createCache({ key: 'muirtl', prepend: true, stylisPlugins: [prefixer, rtlPlugin] }),
}
