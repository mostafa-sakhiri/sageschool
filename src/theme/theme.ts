import { createTheme } from '@mui/material/styles'
import createCache from '@emotion/cache'
import { prefixer } from 'stylis'
import rtlPluginModule from 'stylis-plugin-rtl'

// Linear-style system: white page, light grey cards on it, white fields and
// menus above the cards; one indigo accent, hairline borders, Inter. Every token is a CSS variable so light and dark swap without
// re-rendering; the values live in `schemes` below.
const light = {
  paper: '#FFFFFF',
  card: '#F7F7F8',
  cardWarm: '#F2F2F4',
  // Fields, menus, dialogs: the layer above cards
  surface: '#FFFFFF',
  // Calendar grids inside a card
  content: '#FFFFFF',
  fill: '#EEEEF1',
  fillHover: '#E6E6EA',
  line: '#E4E4E8',
  lineSoft: '#EAEAED',
  lineStrong: '#D2D2D8',
  ink: '#17171A',
  inkSoft: '#3F3F46',
  inkMuted: '#6E6E78',
  accent: '#5E6AD2',
  accentHover: '#4F5BC4',
  accentDark: '#4450B8',
  accentSoft: '#EEF0FD',
  accentLine: '#CDD2F6',
  warn: '#B26B00',
  warnSoft: '#FDF5E6',
  warnLine: '#F1DBAE',
  warnInk: '#8A5300',
  dangerInk: '#C9372C',
  dangerSoft: '#FDEEEC',
  dangerLine: '#F5C6C0',
  infoInk: '#6E48C9',
  infoSoft: '#F4F0FE',
  infoLine: '#DFD4FA',
  inverse: '#1C1C21',
  inverseInk: '#F4F4F5',
  sidebar: '#F7F7F8',
  sidebarInk: '#3F3F46',
  sidebarMuted: '#7C7C86',
  sidebarHover: 'rgba(23, 23, 26, 0.045)',
  sidebarActive: '#FFFFFF',
  header: 'rgba(255, 255, 255, 0.78)',
  napBg: '#F2EFFA',
  napBar: '#D9D2F2',
  recessBg: '#FCF6EA',
  recessBar: '#F0DFBA',
  shadowSm: '0 1px 2px rgba(16, 16, 20, 0.05)',
  shadowMd: '0 1px 2px rgba(16, 16, 20, 0.04), 0 4px 12px rgba(16, 16, 20, 0.08)',
  shadowLg: '0 0 0 1px rgba(16, 16, 20, 0.06), 0 8px 24px rgba(16, 16, 20, 0.12), 0 2px 6px rgba(16, 16, 20, 0.06)',
}

const dark: typeof light = {
  paper: '#0E0E10',
  card: '#151518',
  cardWarm: '#1A1A1E',
  surface: '#1B1B20',
  content: 'transparent',
  fill: '#1F1F24',
  fillHover: '#25252B',
  line: '#26262C',
  lineSoft: '#1F1F24',
  lineStrong: '#34343B',
  ink: '#EDEDEF',
  inkSoft: '#C3C3CB',
  inkMuted: '#8B8B96',
  accent: '#6E79E4',
  accentHover: '#7F89EC',
  accentDark: '#AEB4FA',
  accentSoft: 'rgba(110, 121, 228, 0.14)',
  accentLine: 'rgba(110, 121, 228, 0.36)',
  warn: '#E9A23B',
  warnSoft: 'rgba(233, 162, 59, 0.12)',
  warnLine: 'rgba(233, 162, 59, 0.32)',
  warnInk: '#F2BC6B',
  dangerInk: '#F2837A',
  dangerSoft: 'rgba(235, 87, 75, 0.13)',
  dangerLine: 'rgba(235, 87, 75, 0.34)',
  infoInk: '#BBA3F7',
  infoSoft: 'rgba(152, 114, 240, 0.14)',
  infoLine: 'rgba(152, 114, 240, 0.34)',
  inverse: '#2A2A31',
  inverseInk: '#F4F4F5',
  sidebar: '#0B0B0D',
  sidebarInk: '#C3C3CB',
  sidebarMuted: '#7E7E89',
  sidebarHover: 'rgba(255, 255, 255, 0.045)',
  sidebarActive: 'rgba(255, 255, 255, 0.075)',
  header: 'rgba(14, 14, 16, 0.72)',
  napBg: 'rgba(152, 114, 240, 0.10)',
  napBar: 'rgba(152, 114, 240, 0.32)',
  recessBg: 'rgba(233, 162, 59, 0.08)',
  recessBar: 'rgba(233, 162, 59, 0.30)',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.4)',
  shadowMd: '0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 14px rgba(0, 0, 0, 0.45)',
  shadowLg: '0 0 0 1px rgba(255, 255, 255, 0.06), 0 12px 32px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.4)',
}

// Subject colours for the timetable: soft tint + readable ink, per scheme.
const subjectsLight = [
  ['#E9F0FB', '#2B5089'],
  ['#FCEEE6', '#8A4520'],
  ['#F2EEFD', '#5B3FA8'],
  ['#FCF3DF', '#7E5608'],
  ['#E6F5EF', '#1E6B4F'],
  ['#FBEAF1', '#8C2F57'],
  ['#EEF5E3', '#46631F'],
  ['#E5F2F5', '#2A5E6B'],
]
const subjectsDark = [
  ['rgba(82, 139, 230, 0.16)', '#9CC0F7'],
  ['rgba(230, 125, 70, 0.16)', '#F2AE88'],
  ['rgba(152, 114, 240, 0.17)', '#C4B0FA'],
  ['rgba(222, 170, 50, 0.15)', '#EDCB7A'],
  ['rgba(60, 180, 130, 0.15)', '#86D8B4'],
  ['rgba(225, 90, 145, 0.15)', '#F2A2C3'],
  ['rgba(130, 185, 70, 0.15)', '#B6DB8A'],
  ['rgba(70, 170, 195, 0.15)', '#8FD2E2'],
]
export const SUBJECT_COUNT = subjectsLight.length

type TokenName = keyof typeof light
const cssVar = (name: string) => `var(--ss-${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())})`

export const tokens = {
  ...(Object.fromEntries(Object.keys(light).map((k) => [k, cssVar(k)])) as Record<TokenName, string>),
  display: "'Inter', 'IBM Plex Sans Arabic', system-ui, sans-serif",
}

export const subjectTokens = (i: number) => ({ bg: cssVar(`subject${i}Bg`), ink: cssVar(`subject${i}Ink`) })

function declarations(values: typeof light, subjects: string[][]) {
  const all: Record<string, string> = { ...values }
  subjects.forEach(([bg, ink], i) => {
    all[`subject${i}Bg`] = bg
    all[`subject${i}Ink`] = ink
  })
  return Object.entries(all)
    .map(([k, v]) => `${cssVar(k).slice(4, -1)}:${v};`)
    .join('')
}

// Mirrors MUI's colorSchemeSelector: the init script sets the attribute on
// <html> before first paint, so there is no flash of the wrong scheme.
export const COLOR_SCHEME_ATTRIBUTE = '[data-theme="%s"]'

// Injected as a <style> in the SSR'd <head>.
export const tokenCss =
  `:root,[data-theme="light"]{color-scheme:light;${declarations(light, subjectsLight)}}` +
  `[data-theme="dark"]{color-scheme:dark;${declarations(dark, subjectsDark)}}`

export function createAppTheme(direction: 'ltr' | 'rtl') {
  const body =
    direction === 'rtl'
      ? "'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif"
      : "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
  const heading = (fontSize: string) => ({ fontSize, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.25 })
  const scheme = (v: typeof light) => ({
    palette: {
      primary: { main: v.accent, dark: v.accentHover, contrastText: '#FFFFFF' },
      secondary: { main: v.infoInk },
      warning: { main: v.warn },
      error: { main: v.dangerInk },
      background: { default: v.paper, paper: v.card },
      text: { primary: v.ink, secondary: v.inkMuted },
      divider: v.line,
    },
  })

  return createTheme({
    direction,
    cssVariables: { colorSchemeSelector: COLOR_SCHEME_ATTRIBUTE, cssVarPrefix: 'mui' },
    colorSchemes: { light: scheme(light), dark: scheme(dark) },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: body,
      fontSize: 14,
      h1: heading('1.75rem'),
      h2: heading('1.5rem'),
      h3: heading('1.25rem'),
      h4: { fontSize: '1rem', fontWeight: 600, letterSpacing: '-0.01em' },
      h5: { fontSize: '0.95rem', fontWeight: 600 },
      h6: { fontSize: '0.875rem', fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 500, letterSpacing: 0 },
      overline: { fontWeight: 600, letterSpacing: '0.06em' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: tokens.paper,
            color: tokens.ink,
            fontFeatureSettings: "'tnum' 1, 'cv11' 1, 'ss01' 1",
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          '::selection': { backgroundColor: tokens.accentLine },
          '*': { scrollbarWidth: 'thin', scrollbarColor: `${tokens.lineStrong} transparent` },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 8, minHeight: 32, fontSize: 13.5, paddingInline: 12, transition: 'background-color 120ms, border-color 120ms, box-shadow 120ms' },
          sizeSmall: { minHeight: 28, fontSize: 12.5, paddingInline: 10 },
          contained: { boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 2px rgba(0,0,0,0.12)' },
          outlined: {
            borderColor: tokens.line,
            backgroundColor: tokens.surface,
            '&.MuiButton-colorPrimary': { color: tokens.ink },
            '&:hover': { borderColor: tokens.lineStrong, backgroundColor: tokens.fill },
          },
          text: { '&:hover': { backgroundColor: tokens.fill } },
        },
      },
      MuiIconButton: {
        styleOverrides: { root: { borderRadius: 8, color: tokens.inkMuted, '&:hover': { backgroundColor: tokens.fill, color: tokens.ink } } },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none' },
          outlined: { borderColor: tokens.line, backgroundColor: tokens.card },
          rounded: { borderRadius: 12 },
        },
      },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: { root: { borderRadius: 12, borderColor: tokens.line, backgroundColor: tokens.card } },
      },
      MuiPopover: {
        styleOverrides: { paper: { borderRadius: 10, boxShadow: tokens.shadowLg, backgroundColor: tokens.surface } },
      },
      MuiMenu: {
        styleOverrides: { list: { padding: 4 } },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            fontSize: 13.5,
            minHeight: 34,
            '&:hover': { backgroundColor: tokens.fill },
            '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: tokens.accentSoft },
          },
        },
      },
      MuiListItemIcon: { styleOverrides: { root: { color: tokens.inkMuted, minWidth: 32 } } },
      MuiListSubheader: {
        styleOverrides: { root: { backgroundColor: 'transparent', color: tokens.inkMuted, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' } },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: 14, boxShadow: tokens.shadowLg, backgroundColor: tokens.surface } },
      },
      MuiBackdrop: {
        styleOverrides: { root: { '&:not(.MuiBackdrop-invisible)': { backgroundColor: 'rgba(8, 8, 10, 0.45)', backdropFilter: 'blur(2px)' } } },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundColor: tokens.sidebar, backgroundImage: 'none' } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { backgroundColor: tokens.inverse, color: tokens.inverseInk, fontSize: 12, fontWeight: 500, borderRadius: 6, padding: '5px 8px', boxShadow: tokens.shadowMd },
          arrow: { color: tokens.inverse },
        },
      },
      MuiSnackbarContent: {
        styleOverrides: { root: { backgroundColor: tokens.inverse, color: tokens.inverseInk, borderRadius: 10, boxShadow: tokens.shadowLg } },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: tokens.surface,
            transition: 'box-shadow 120ms',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: tokens.line },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: tokens.lineStrong },
            '&.Mui-focused': { boxShadow: `0 0 0 3px ${tokens.accentSoft}` },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: tokens.accent, borderWidth: 1 },
          },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { fontSize: 13.5 } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 500, borderRadius: 6 } } },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderColor: tokens.line,
            backgroundColor: tokens.surface,
            color: tokens.inkMuted,
            fontSize: 12.5,
            textTransform: 'none',
            '&.Mui-selected': { backgroundColor: tokens.fill, color: tokens.ink },
            '&.Mui-selected:hover': { backgroundColor: tokens.fillHover },
          },
        },
      },
      MuiToggleButtonGroup: { styleOverrides: { root: { borderRadius: 8 } } },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: tokens.lineSoft },
          head: { fontWeight: 500, color: tokens.inkMuted, fontSize: 12, letterSpacing: '0.01em', backgroundColor: tokens.cardWarm },
        },
      },
      MuiTableBody: { styleOverrides: { root: { backgroundColor: tokens.card } } },
      MuiTableRow: { styleOverrides: { hover: { '&:hover': { backgroundColor: `${tokens.cardWarm} !important` } } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500, minHeight: 40 } } },
      MuiTabs: { styleOverrides: { root: { minHeight: 40 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiDivider: { styleOverrides: { root: { borderColor: tokens.line } } },
      MuiAvatar: { styleOverrides: { root: { fontWeight: 600 } } },
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
