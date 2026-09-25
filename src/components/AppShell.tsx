import { useState } from 'react'
import { Link, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  Avatar,
  Box,
  Button,
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
import MenuIcon from '@mui/icons-material/Menu'
import LogoutOutlined from '@mui/icons-material/LogoutOutlined'
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import { useI18n } from '#/i18n/i18n'
import { rememberRole, rememberSchool, useSchool, type Role } from '#/lib/session'
import { supabase } from '#/lib/supabase/client'
import { tokens } from '#/theme/theme'
import { ContextSwitcher } from './ContextSwitcher'
import { QuickActions } from './QuickActions'

type NavItem = { to: string; key: string; icon: React.ReactNode; roles: Role[] }

const NAV: NavItem[] = [
  { to: '/', key: 'nav.dashboard', icon: <DashboardOutlined />, roles: ['admin', 'staff', 'teacher', 'parent', 'student'] },
  { to: '/setup', key: 'nav.settings', icon: <SettingsOutlined />, roles: ['admin'] },
  { to: '/team', key: 'nav.team', icon: <GroupsOutlined />, roles: ['admin'] },
  { to: '/classes', key: 'nav.classes', icon: <ClassOutlined />, roles: ['admin', 'staff'] },
  { to: '/students', key: 'nav.students', icon: <FaceOutlined />, roles: ['admin', 'staff'] },
  { to: '/timetable', key: 'nav.timetable', icon: <CalendarMonthOutlined />, roles: ['admin', 'staff', 'teacher', 'parent', 'student'] },
  { to: '/attendance', key: 'nav.attendance', icon: <FactCheckOutlined />, roles: ['admin', 'staff', 'teacher', 'parent', 'student'] },
  { to: '/homework', key: 'nav.homework', icon: <MenuBookOutlined />, roles: ['teacher', 'parent', 'student'] },
  { to: '/announcements', key: 'nav.announcements', icon: <CampaignOutlined />, roles: ['admin', 'staff', 'teacher', 'parent'] },
  { to: '/fees', key: 'nav.fees', icon: <PaymentsOutlined />, roles: ['admin', 'staff', 'parent'] },
  { to: '/cases', key: 'nav.cases', icon: <ForumOutlined />, roles: ['admin', 'staff', 'parent'] },
]

export const SIDEBAR_WIDTH = 236

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const

export function AppShell({ title, children }: { title?: string; children: React.ReactNode }) {
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const [open, setOpen] = useState(false)
  const { t } = useI18n()

  const sidebar = <Sidebar onNavigate={() => setOpen(false)} />
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: tokens.paper }}>
      {desktop ? (
        <Box
          component="nav"
          aria-label={t('nav.main')}
          sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, position: 'sticky', top: 0, height: '100vh' }}
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
          </Box>
        )}
        <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 4 }, pt: { md: 4.5 } }}>
          {children}
        </Box>
      </Box>
    </Box>
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

function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const items = NAV.filter((n) => n.roles.includes(ctx.role))

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
      }}
    >
      <ContextSwitcher />
      <QuickActions onDone={onNavigate} />

      <Stack spacing={0.25}>
        {items.map((n) => {
          const on = n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)
          return (
            <Box
              key={n.to}
              component={Link}
              to={n.to}
              onClick={onNavigate}
              aria-current={on ? 'page' : undefined}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                minHeight: 32,
                px: 1,
                borderRadius: '7px',
                fontSize: 13.5,
                textDecoration: 'none',
                color: on ? tokens.ink : tokens.sidebarInk,
                bgcolor: on ? tokens.sidebarActive : 'transparent',
                boxShadow: on ? tokens.shadowSm : 'none',
                fontWeight: on ? 500 : 400,
                transition: 'background-color 100ms, color 100ms',
                '&:hover': { bgcolor: on ? tokens.sidebarActive : tokens.sidebarHover, color: tokens.ink },
                '& svg': { fontSize: 17, color: on ? tokens.accent : tokens.sidebarMuted },
                '&:focus-visible': { outline: `2px solid ${tokens.accentLine}`, outlineOffset: 2 },
              }}
            >
              {n.icon}
              {t(n.key)}
            </Box>
          )
        })}
      </Stack>

      <Box sx={{ flex: 1 }} />
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 0.5, pt: 1.5, borderTop: `1px solid ${tokens.line}` }}>
        <LanguageToggle />
        <ThemeToggle />
      </Stack>
      <UserCard />
    </Box>
  )
}

function UserCard() {
  const { t } = useI18n()
  const ctx = useSchool()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
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
            justifyContent: 'flex-start',
            gap: 1.25,
            p: 0.75,
            borderRadius: '8px',
            color: tokens.ink,
            textAlign: 'start',
            '&:hover': { bgcolor: tokens.sidebarHover },
          }}
        >
          <Avatar sx={{ width: 28, height: 28, bgcolor: tokens.accentSoft, color: tokens.accentDark, fontSize: 11, fontWeight: 600 }}>
            {initials}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
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
        <MenuItem onClick={signOut}>
          <ListItemIcon>
            <LogoutOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('shell.signOut')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}
