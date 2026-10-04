import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import CakeOutlined from '@mui/icons-material/CakeOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import KeyOutlined from '@mui/icons-material/KeyOutlined'
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import ChevronLeftOutlined from '@mui/icons-material/ChevronLeftOutlined'
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined'
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined'
import StoreOutlined from '@mui/icons-material/StoreOutlined'
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined'
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined'
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined'
import MeetingRoomOutlined from '@mui/icons-material/MeetingRoomOutlined'
import { useI18n } from '#/i18n/i18n'
import { rememberRole, rememberSchool, useSchool, type Permission, type Role, type SchoolCtx } from '#/lib/session'
import { supabase } from '#/lib/supabase/client'
import { tokens } from '#/theme/theme'
import { ContextSwitcher } from './ContextSwitcher'
import { ContactDialog } from '#/features/team/ContactDialog'
import { formatPhone } from '#/lib/format'
import ContactPhoneOutlined from '@mui/icons-material/ContactPhoneOutlined'
import { QuickActions } from './QuickActions'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import { useAssistantUi } from '#/features/assistant/shell'
import { casesQuery } from '#/features/queries'

// `roles`: shown to these roles whatever their permissions (their children,
// themselves...); `permissions`: also shown to anyone holding one of them.
// `group`: the office's sections; other roles get a flat list. `familyKey`:
// the label for parents and students.
type NavGroup = 'school' | 'families' | 'welcome'
type NavItem = {
  to: string
  key: string
  familyKey?: string
  icon: React.ReactNode
  roles: Role[]
  permissions?: Permission[]
  group?: NavGroup
  when?: (ctx: SchoolCtx) => boolean
}

const NAV: NavItem[] = [
  { to: '/', key: 'nav.dashboard', icon: <DashboardOutlined />, roles: ['admin', 'staff', 'teacher', 'parent', 'student'] },
  // Vie scolaire
  { to: '/students', key: 'nav.students', icon: <FaceOutlined />, roles: [], permissions: ['students.view'], group: 'school' },
  // Admins find the classes in the settings (the year's section)
  { to: '/classes', key: 'nav.classes', icon: <ClassOutlined />, roles: [], permissions: ['classes.view_all'], group: 'school', when: (c) => !c.isAdmin },
  { to: '/attendance', key: 'nav.attendance', icon: <FactCheckOutlined />, roles: ['parent', 'student'], permissions: ['attendance.view_all', 'attendance.take_own'], group: 'school' },
  { to: '/timetable', key: 'nav.timetable', icon: <CalendarMonthOutlined />, roles: ['admin', 'staff', 'teacher', 'parent', 'student'], group: 'school' },
  { to: '/homework', key: 'nav.homework', icon: <MenuBookOutlined />, roles: ['parent', 'student'], permissions: ['homework.own'], group: 'school' },
  // Familles: what they ask, what they're told, what they pay
  { to: '/cases', key: 'nav.cases', familyKey: 'nav.casesParent', icon: <ForumOutlined />, roles: ['parent'], permissions: ['messages.view'], group: 'families' },
  { to: '/announcements', key: 'nav.announcements', icon: <CampaignOutlined />, roles: ['teacher', 'parent'], permissions: ['announcements.view_all'], group: 'families' },
  { to: '/fees', key: 'nav.fees', icon: <PaymentsOutlined />, roles: ['parent'], permissions: ['fees.view'], group: 'families' },
  // Accueil
  { to: '/preregistrations', key: 'nav.preregistrations', icon: <HowToRegOutlined />, roles: [], permissions: ['preregistrations.view'], group: 'welcome' },
  { to: '/agenda', key: 'nav.agenda', icon: <EventNoteOutlined />, roles: [], permissions: ['agenda.view'], group: 'welcome' },
  { to: '/events', key: 'nav.events', icon: <CakeOutlined />, roles: [], permissions: ['events.birthdays'], group: 'welcome' },
]
const GROUPS: NavGroup[] = ['welcome', 'school', 'families']

// The settings' own nav (admin): what belongs to the school, then what belongs
// to the selected school year. `tab` = a section of /setup.
type SettingsItem = { key: string; icon: React.ReactNode; to: '/setup' | '/team' | '/classes'; tab?: string }
const SCHOOL_SETTINGS: SettingsItem[] = [
  { to: '/setup', tab: 'school', key: 'settings.tab.school', icon: <StoreOutlined /> },
  { to: '/team', key: 'settings.nav.team', icon: <GroupsOutlined /> },
  { to: '/setup', tab: 'roles', key: 'settings.tab.roles', icon: <AdminPanelSettingsOutlined /> },
  { to: '/setup', tab: 'structure', key: 'settings.tab.structure', icon: <AccountTreeOutlined /> },
  { to: '/setup', tab: 'schedule', key: 'settings.tab.schedule', icon: <ScheduleOutlined /> },
  { to: '/setup', tab: 'rooms', key: 'settings.tab.rooms', icon: <MeetingRoomOutlined /> },
]
const YEAR_SETTINGS: SettingsItem[] = [
  { to: '/classes', key: 'nav.classes', icon: <ClassOutlined /> },
  { to: '/setup', tab: 'hours', key: 'settings.tab.hours', icon: <MenuBookOutlined /> },
]
const SETTINGS_PATHS = ['/setup', '/team', '/classes']
export function isSettingsPath(pathname: string, ctx: SchoolCtx) {
  return ctx.isAdmin && SETTINGS_PATHS.includes(pathname)
}

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
  const items = NAV.filter((n) => (n.roles.includes(ctx.role) || !!n.permissions?.some((p) => ctx.can(p))) && (!n.when || n.when(ctx)))
  // The office gets sections; a teacher or a family, a short flat list
  const sectioned = ctx.isOffice && new Set(items.map((n) => n.group).filter(Boolean)).size > 1
  const family = ctx.role === 'parent' || ctx.role === 'student'
  // Requests waiting for an answer, next to "Demandes des parents"
  const cases = useQuery({ ...casesQuery(ctx.school.id), enabled: ctx.can('messages.view') && !family })
  const waiting = (cases.data ?? []).filter((c) => c.status === 'open').length
  const link = (n: NavItem) => (
    <NavLink
      key={n.to}
      to={n.to}
      label={t(family && n.familyKey ? n.familyKey : n.key)}
      icon={n.icon}
      badge={n.to === '/cases' && !family ? waiting : 0}
      on={n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)}
      compact={compact}
      onClick={onNavigate}
    />
  )
  const settings = isSettingsPath(pathname, ctx)
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
      {settings ? (
        <SettingsNav onNavigate={onNavigate} compact={compact} />
      ) : (
        <>
          <QuickActions onDone={onNavigate} compact={compact} />
          <Stack spacing={0.25}>
            <AssistantNavItem onDone={onNavigate} compact={compact} />
            {(sectioned ? items.filter((n) => !n.group) : items).map(link)}
          </Stack>
          {sectioned &&
            GROUPS.map((g) => {
              const inGroup = items.filter((n) => n.group === g)
              if (!inGroup.length) return null
              return (
                <Box key={g}>
                  <NavHeading compact={compact}>{t(`nav.group.${g}`)}</NavHeading>
                  <Stack spacing={0.25}>{inGroup.map(link)}</Stack>
                </Box>
              )
            })}
        </>
      )}

      <Box sx={{ flex: 1 }} />
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 0.5, pt: 1.5, borderTop: `1px solid ${tokens.line}` }}>
        <Collapse in={!compact} orientation="horizontal" timeout={200}>
          <LanguageToggle />
        </Collapse>
        <ThemeToggle />
      </Stack>
      {ctx.isAdmin && (
        <Box sx={{ mt: 1 }}>
          <NavLink to="/setup" label={t('nav.settings')} icon={<SettingsOutlined />} on={settings} compact={compact} onClick={onNavigate} />
        </Box>
      )}
      <UserCard compact={compact} />
    </Box>
  )
}

function NavLink({
  to,
  search,
  label,
  icon,
  badge = 0,
  on,
  compact,
  onClick,
}: {
  to: string
  search?: Record<string, string>
  label: string
  icon: React.ReactNode
  // a count waiting there (a dot when the sidebar is folded)
  badge?: number
  on: boolean
  compact: boolean
  onClick: () => void
}) {
  return (
    <Tooltip title={compact ? label : ''} placement="right">
      <Box
        component={Link}
        to={to}
        search={search as never}
        onClick={onClick}
        aria-current={on ? 'page' : undefined}
        aria-label={label}
        sx={navItemSx(on)}
      >
        <Box component="span" sx={{ position: 'relative', display: 'inline-flex' }}>
          {icon}
          {compact && badge > 0 && (
            <Box component="span" sx={{ position: 'absolute', top: -2, insetInlineEnd: -3, width: 7, height: 7, borderRadius: '50%', bgcolor: tokens.dangerInk }} />
          )}
        </Box>
        <NavLabel hidden={compact}>{label}</NavLabel>
        {!compact && badge > 0 && (
          <Box
            component="span"
            sx={{ marginInlineStart: 'auto', minWidth: 20, height: 18, px: 0.6, borderRadius: '9px', bgcolor: tokens.dangerSoft, color: tokens.dangerInk, fontSize: 11.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {badge}
          </Box>
        )}
      </Box>
    </Tooltip>
  )
}

// Small caps heading of a settings section (a rule when the sidebar is folded)
function NavHeading({ compact, children }: { compact: boolean; children: React.ReactNode }) {
  return (
    <Box sx={{ position: 'relative', height: 30, mt: 1.5, mb: 0.25 }}>
      <Typography
        component="h2"
        noWrap
        sx={{ px: 1, pt: 1, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: tokens.sidebarMuted, opacity: compact ? 0 : 1, transition: `opacity ${EASE}` }}
      >
        {children}
      </Typography>
      {compact && <Box sx={{ position: 'absolute', insetInline: 8, top: 15, height: '1px', bgcolor: tokens.line }} />}
    </Box>
  )
}

// The settings replace the main nav: a way back, the school's settings, then
// the selected school year's.
function SettingsNav({ onNavigate, compact }: { onNavigate: () => void; compact: boolean }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const tab = useRouterState({ select: (s) => (s.location.search as { tab?: string }).tab ?? 'school' })
  const isOn = (i: SettingsItem) => pathname === i.to && (!i.tab || i.tab === tab)
  const render = (i: SettingsItem) => (
    <NavLink
      key={i.key}
      to={i.to}
      search={i.tab ? { tab: i.tab } : undefined}
      label={t(i.key)}
      icon={i.icon}
      on={isOn(i)}
      compact={compact}
      onClick={onNavigate}
    />
  )
  return (
    <Box sx={{ mt: 1.5 }}>
      <NavLink to="/" label={t('settings.nav.back')} icon={<ArrowBackOutlined />} on={false} compact={compact} onClick={onNavigate} />
      <NavHeading compact={compact}>{t('settings.nav.school')}</NavHeading>
      <Stack spacing={0.25}>{SCHOOL_SETTINGS.map(render)}</Stack>
      <NavHeading compact={compact}>
        {ctx.year ? t('settings.nav.year', { name: ctx.year.name }) : t('settings.nav.noYear')}
      </NavHeading>
      <Stack spacing={0.25}>{YEAR_SETTINGS.map(render)}</Stack>
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
