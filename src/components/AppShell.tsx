import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Collapse,
  Drawer,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useColorScheme,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import DashboardOutlined from '@mui/icons-material/DashboardOutlined'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import ClassOutlined from '@mui/icons-material/ClassOutlined'
import FaceOutlined from '@mui/icons-material/FaceOutlined'
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined'
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined'
import CampaignOutlined from '@mui/icons-material/CampaignOutlined'
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined'
import ForumOutlined from '@mui/icons-material/ForumOutlined'
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined'
import EventNoteOutlined from '@mui/icons-material/EventNoteOutlined'
import HowToRegOutlined from '@mui/icons-material/HowToRegOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import KeyOutlined from '@mui/icons-material/KeyOutlined'
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined'
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined'
import { useI18n } from '#/i18n/i18n'
import { rememberRole, rememberSchool, useSchool, type Role, type SchoolCtx } from '#/lib/session'
import { supabase } from '#/lib/supabase/client'
import { tokens } from '#/theme/theme'
import { ContextSwitcher } from './ContextSwitcher'
import { ContactDialog } from '#/features/team/ContactDialog'
import { formatPhone } from '#/lib/format'
import ContactPhoneOutlined from '@mui/icons-material/ContactPhoneOutlined'
import { QuickActions } from './QuickActions'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import { useAssistantUi } from '#/features/assistant/shell'

type NavItem = { to: string; key: string; icon: React.ReactNode; roles: Role[]; when?: (ctx: SchoolCtx) => boolean }

const NAV: NavItem[] = [
  { to: '/', key: 'nav.dashboard', icon: <DashboardOutlined />, roles: ['admin', 'staff', 'teacher', 'parent', 'student'] },
  { to: '/setup', key: 'nav.settings', icon: <SettingsOutlined />, roles: ['admin'] },
  { to: '/team', key: 'nav.team', icon: <GroupsOutlined />, roles: ['admin'] },
  { to: '/classes', key: 'nav.classes', icon: <ClassOutlined />, roles: ['admin', 'staff'] },
  { to: '/students', key: 'nav.students', icon: <FaceOutlined />, roles: ['admin', 'staff'] },
  { to: '/preregistrations', key: 'nav.preregistrations', icon: <HowToRegOutlined />, roles: ['admin', 'staff'] },
  { to: '/agenda', key: 'nav.agenda', icon: <EventNoteOutlined />, roles: ['admin', 'staff'] },
  { to: '/timetable', key: 'nav.timetable', icon: <CalendarMonthOutlined />, roles: ['admin', 'staff', 'teacher', 'parent', 'student'] },
  { to: '/attendance', key: 'nav.attendance', icon: <FactCheckOutlined />, roles: ['admin', 'staff', 'teacher', 'parent', 'student'] },
  { to: '/homework', key: 'nav.homework', icon: <MenuBookOutlined />, roles: ['teacher', 'parent', 'student'] },
  { to: '/announcements', key: 'nav.announcements', icon: <CampaignOutlined />, roles: ['admin', 'staff', 'teacher', 'parent'] },
  { to: '/fees', key: 'nav.fees', icon: <PaymentsOutlined />, roles: ['admin', 'staff', 'parent'], when: (c) => c.role === 'parent' || c.canFees },
  { to: '/cases', key: 'nav.cases', icon: <ForumOutlined />, roles: ['admin', 'staff', 'parent'] },
]

export const SIDEBAR_WIDTH = 236
// Folded sidebar: icons only (pages that need the width, e.g. the timetable editor)
export const RAIL_WIDTH = 56

// Folded or not is the person's choice, kept across pages and visits. A page
// may fold it (the timetable editor, on entering it); nothing unfolds it but
// the person.
const LS_NAV = 'sage.nav.folded'
let navFolded: boolean | null = null
const navListeners = new Set<() => void>()
function getNavFolded() {
  if (navFolded === null) {
    try {
      navFolded = localStorage.getItem(LS_NAV) === '1'
    } catch {
      navFolded = false
    }
  }
  return navFolded
}
function setNavFolded(v: boolean) {
  navFolded = v
  try {
    localStorage.setItem(LS_NAV, v ? '1' : '0')
  } catch {
    /* private mode: the choice just isn't remembered */
  }
  for (const l of navListeners) l()
}
function useNavFolded() {
  return useSyncExternalStore(
    (l) => {
      navListeners.add(l)
      return () => navListeners.delete(l)
    },
    getNavFolded,
    () => false,
  )
}

const EASE = '200ms cubic-bezier(0.4, 0, 0.2, 1)'
// A label that fades while the sidebar folds (the icons never move)
function NavLabel({ hidden, children }: { hidden: boolean; children: React.ReactNode }) {
  return (
    <Box component="span" sx={{ whiteSpace: 'nowrap', opacity: hidden ? 0 : 1, transition: `opacity ${EASE}` }}>
      {children}
    </Box>
  )
}

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

// `compactNav`: the page folds the sidebar when it opens (the person can
// unfold it; leaving the page doesn't unfold it).
export function AppShell({ title, children, compactNav }: { title?: string; children: React.ReactNode; compactNav?: boolean }) {
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const [open, setOpen] = useState(false)
  const folded = useNavFolded()
  const compact = desktop && folded
  useEffect(() => {
    if (compactNav) setNavFolded(true)
  }, [compactNav])
  const { t } = useI18n()
  const assistant = useAssistantUi()

  const sidebar = (
    <Sidebar
      onNavigate={() => setOpen(false)}
      compact={compact}
      onFold={desktop ? () => setNavFolded(!folded) : undefined}
    />
  )
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: tokens.paper }}>
      {desktop ? (
        <Box
          component="nav"
          aria-label={t('nav.main')}
          sx={{ width: compact ? RAIL_WIDTH : SIDEBAR_WIDTH, flexShrink: 0, position: 'sticky', top: 0, height: '100vh', transition: `width ${EASE}` }}
        >
          {sidebar}
        </Box>
      ) : (
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          anchor="left"
          slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, border: 0 } } }}
        >
          {sidebar}
        </Drawer>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Desktop: no header, the page intro carries the title; the h1 stays
            for screen readers. Mobile: a slim bar to open the menu. */}
        {desktop ? (
          <Typography component="h1" sx={visuallyHidden}>
            {title}
          </Typography>
        ) : (
          <Box
            component="header"
            sx={{
              height: 52,
              px: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              bgcolor: tokens.header,
              backdropFilter: 'saturate(180%) blur(12px)',
              borderBottom: `1px solid ${tokens.line}`,
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <IconButton aria-label={t('nav.openMenu')} onClick={() => setOpen(true)}>
              <MenuIcon />
            </IconButton>
            <Typography component="h1" variant="h4" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {title}
            </Typography>
            {assistant && (
              <IconButton aria-label={t('assistant.title')} onClick={() => assistant.setOpen(!assistant.open)} sx={{ color: tokens.accent }}>
                <AutoAwesomeOutlined />
              </IconButton>
            )}
          </Box>
        )}
        <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 4 }, pt: { md: 4.5 } }}>
          {children}
        </Box>
      </Box>
      {/* The assistant's column: the chat is part of the page, next to it */}
      {assistant && desktop && (
        <Box
          ref={assistant.dock}
          sx={{ width: assistant.width, flexShrink: 0, position: 'sticky', top: 0, height: '100vh', display: assistant.open ? 'block' : 'none' }}
        />
      )}
    </Box>
  )
}

const navItemSx = (on: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 1.25,
  minHeight: 32,
  px: 1,
  borderRadius: '7px',
  fontSize: 13.5,
  textDecoration: 'none',
  overflow: 'hidden',
  color: on ? tokens.ink : tokens.sidebarInk,
  bgcolor: on ? tokens.sidebarActive : 'transparent',
  boxShadow: on ? tokens.shadowSm : 'none',
  fontWeight: on ? 500 : 400,
  transition: 'background-color 100ms, color 100ms',
  '&:hover': { bgcolor: on ? tokens.sidebarActive : tokens.sidebarHover, color: tokens.ink },
  '& svg': { fontSize: 17, flexShrink: 0, color: on ? tokens.accent : tokens.sidebarMuted },
  '&:focus-visible': { outline: `2px solid ${tokens.accentLine}`, outlineOffset: 2 },
})

// The assistant, first entry of the nav (office roles): shows or hides its
// column; highlighted while open, its icon always in the accent colour.
function AssistantNavItem({ onDone, compact }: { onDone: () => void; compact: boolean }) {
  const assistant = useAssistantUi()
  const { t } = useI18n()
  if (!assistant) return null
  return (
    <Tooltip title={compact ? t('assistant.title') : ''} placement="right">
      <ButtonBase
        onClick={() => {
          assistant.setOpen(!assistant.open)
          onDone()
        }}
        aria-pressed={assistant.open}
        aria-label={t('assistant.title')}
        sx={{ ...navItemSx(assistant.open), justifyContent: 'flex-start', fontFamily: 'inherit', '& svg': { fontSize: 17, flexShrink: 0, color: tokens.accent } }}
      >
        <AutoAwesomeOutlined />
        <NavLabel hidden={compact}>{t('assistant.title')}</NavLabel>
      </ButtonBase>
    </Tooltip>
  )
}

// Light / dark, remembered per browser by MUI (localStorage).
export function ThemeToggle() {
  const { t } = useI18n()
  const { mode, systemMode, setMode } = useColorScheme()
  const isDark = (mode === 'system' ? systemMode : mode) === 'dark'
  const label = t(isDark ? 'theme.light' : 'theme.dark')
  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} onClick={() => setMode(isDark ? 'light' : 'dark')} size="small" sx={{ width: 32, height: 32 }}>
        {isDark ? <LightModeOutlined sx={{ fontSize: 18 }} /> : <DarkModeOutlined sx={{ fontSize: 18 }} />}
      </IconButton>
    </Tooltip>
  )
}

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n()
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={locale}
      onChange={(_, v) => v && setLocale(v)}
      aria-label={t('common.language')}
    >
      <ToggleButton value="fr" sx={{ px: 1.25, py: 0.5, fontWeight: 500 }} lang="fr">
        FR
      </ToggleButton>
      <ToggleButton value="ar" sx={{ px: 1.25, py: 0.5, fontWeight: 500 }} lang="ar">
        عربي
      </ToggleButton>
    </ToggleButtonGroup>
  )
}

function Sidebar({ onNavigate, compact, onFold }: { onNavigate: () => void; compact: boolean; onFold?: () => void }) {
  const { t, dir } = useI18n()
  const ctx = useSchool()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const items = NAV.filter((n) => n.roles.includes(ctx.role) && (!n.when || n.when(ctx)))
  // Chevron towards where the sidebar would grow or shrink (mirrored in RTL)
  const unfoldIcon = (compact ? dir !== 'rtl' : dir === 'rtl') ? <ChevronRightOutlined fontSize="small" /> : <ChevronLeftOutlined fontSize="small" />

  return (
    <Box
      sx={{
        height: '100%',
        bgcolor: tokens.sidebar,
        borderInlineEnd: `1px solid ${tokens.line}`,
        px: 1.25,
        py: 1.5,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {onFold && (
        <Tooltip title={compact ? t('shell.unfoldNav') : t('shell.foldNav')} placement="right">
          <IconButton size="small" onClick={onFold} aria-label={compact ? t('shell.unfoldNav') : t('shell.foldNav')} aria-expanded={!compact} sx={{ alignSelf: 'flex-start', mb: 1 }}>
            {unfoldIcon}
          </IconButton>
        </Tooltip>
      )}
      <Collapse in={!compact} timeout={200}>
        <ContextSwitcher />
      </Collapse>
      <QuickActions onDone={onNavigate} compact={compact} />

      <Stack spacing={0.25}>
        <AssistantNavItem onDone={onNavigate} compact={compact} />
        {items.map((n) => {
          const on = n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)
          return (
            <Tooltip key={n.to} title={compact ? t(n.key) : ''} placement="right">
              <Box
                component={Link}
                to={n.to}
                onClick={onNavigate}
                aria-current={on ? 'page' : undefined}
                aria-label={t(n.key)}
                sx={navItemSx(on)}
              >
                {n.icon}
                <NavLabel hidden={compact}>{t(n.key)}</NavLabel>
              </Box>
            </Tooltip>
          )
        })}
      </Stack>

      <Box sx={{ flex: 1 }} />
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 0.5, pt: 1.5, borderTop: `1px solid ${tokens.line}` }}>
        <Collapse in={!compact} orientation="horizontal" timeout={200}>
          <LanguageToggle />
        </Collapse>
        <ThemeToggle />
      </Stack>
      <UserCard compact={compact} />
    </Box>
  )
}

function UserCard({ compact }: { compact?: boolean }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [contactOpen, setContactOpen] = useState(false)
  const initials = ctx.user.full_name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const signOut = async () => {
    await supabase.auth.signOut()
    queryClient.clear()
    navigate({ to: '/login', search: {} })
  }

  const switchTo = async (schoolId: string, role?: Role) => {
    setAnchor(null)
    if (role) rememberRole(schoolId, role)
    rememberSchool(schoolId)
    // Re-run the layout's beforeLoad so loaders prefetch for the new school.
    await router.invalidate()
    navigate({ to: '/' })
  }

  return (
    <>
      <Tooltip title={t('shell.account')}>
        <Button
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            mt: 1,
            minWidth: 0,
            overflow: 'hidden',
            justifyContent: 'flex-start',
            gap: 1.25,
            p: 0.75,
            borderRadius: '8px',
            color: tokens.ink,
            textAlign: 'start',
            '&:hover': { bgcolor: tokens.sidebarHover },
          }}
        >
          <Avatar sx={{ flexShrink: 0, width: 28, height: 28, bgcolor: tokens.accentSoft, color: tokens.accentDark, fontSize: 11, fontWeight: 600 }}>
            {initials}
          </Avatar>
          <Box sx={{ minWidth: 0, opacity: compact ? 0 : 1, transition: `opacity ${EASE}` }}>
            <Typography noWrap dir="auto" sx={{ fontSize: 13, fontWeight: 500 }}>
              {ctx.user.full_name}
            </Typography>
            <Typography noWrap sx={{ fontSize: 11, color: tokens.sidebarMuted }}>
              {t(`role.${ctx.role}`)}
            </Typography>
          </Box>
        </Button>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {ctx.roles.length > 1 &&
          ctx.roles.map((r) => (
            <MenuItem key={r} onClick={() => switchTo(ctx.school.id, r)} selected={r === ctx.role}>
              <ListItemIcon>{r === ctx.role ? <CheckOutlined fontSize="small" /> : <SwapHorizOutlined fontSize="small" />}</ListItemIcon>
              <ListItemText>{t('shell.actAs', { role: t(`role.${r}`) })}</ListItemText>
            </MenuItem>
          ))}
        <MenuItem
          onClick={() => {
            setAnchor(null)
            setContactOpen(true)
          }}
        >
          <ListItemIcon>
            <ContactPhoneOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('contact.mine')} secondary={formatPhone(ctx.user.phone) || t('contact.noPhone')} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null)
            navigate({ to: '/reset-password', search: {} })
          }}
        >
          <ListItemIcon>
            <KeyOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('reset.mine')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={signOut}>
          <ListItemIcon>
            <LogoutOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('shell.signOut')}</ListItemText>
        </MenuItem>
      </Menu>
      {contactOpen && (
        <ContactDialog
          target={{ memberId: ctx.member.id, fullName: ctx.user.full_name, phone: ctx.user.phone, email: ctx.user.email }}
          schoolId={ctx.school.id}
          onClose={() => setContactOpen(false)}
        />
      )}
    </>
  )
}
