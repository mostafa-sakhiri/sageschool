import { useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
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
import { useI18n } from '#/i18n/i18n'
import { rememberRole, rememberSchool, useSchool, type Role } from '#/lib/session'
import { supabase } from '#/lib/supabase/client'
import { tokens } from '#/theme/theme'

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
          anchor={theme.direction === 'rtl' ? 'right' : 'left'}
          slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, border: 0 } } }}
        >
          {sidebar}
        </Drawer>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box
          component="header"
          sx={{
            height: 64,
            px: { xs: 2, md: 3.5 },
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            bgcolor: '#FFFFFF',
            borderBottom: `1px solid ${tokens.line}`,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          {!desktop && (
            <IconButton aria-label={t('nav.openMenu')} onClick={() => setOpen(true)} edge="start">
              <MenuIcon />
            </IconButton>
          )}
          <Typography component="h1" variant="h4" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {title}
          </Typography>
          <LanguageToggle />
        </Box>
        <Box component="main" sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3.5 } }}>
          {children}
        </Box>
      </Box>
    </Box>
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
      <ToggleButton value="fr" sx={{ px: 1.5, fontWeight: 600 }} lang="fr">
        FR
      </ToggleButton>
      <ToggleButton value="ar" sx={{ px: 1.5, fontWeight: 600 }} lang="ar">
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
        px: 1.75,
        py: 2.25,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', px: 0.5, mb: 2.75 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '10px',
            bgcolor: tokens.accent,
            color: '#fff',
            display: 'grid',
            placeItems: 'center',
            fontFamily: tokens.display,
            fontWeight: 600,
            fontSize: 17,
            flexShrink: 0,
          }}
        >
          {ctx.school.name.charAt(0).toUpperCase()}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 13, fontWeight: 600, color: tokens.paper }}>
            {ctx.school.name}
          </Typography>
          <Typography noWrap sx={{ fontSize: 11, color: tokens.sidebarMuted }}>
            {ctx.year ? t('shell.year', { name: ctx.year.name }) : t('shell.noYear')}
          </Typography>
        </Box>
      </Stack>

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
                gap: 1.4,
                minHeight: 40,
                px: 1.4,
                borderRadius: '10px',
                fontSize: 13.5,
                textDecoration: 'none',
                color: on ? tokens.ink : tokens.sidebarInk,
                bgcolor: on ? '#FFFFFF' : 'transparent',
                fontWeight: on ? 600 : 400,
                '&:hover': { bgcolor: on ? '#FFFFFF' : 'rgba(255,255,255,0.08)' },
                '& svg': { fontSize: 18, opacity: 0.9 },
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
      <UserCard />
    </Box>
  )
}

function UserCard() {
  const { t } = useI18n()
  const ctx = useSchool()
  const navigate = useNavigate()
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

  const switchTo = (schoolId: string, role?: Role) => {
    rememberSchool(schoolId)
    if (role) rememberRole(schoolId, role)
    setAnchor(null)
    queryClient.invalidateQueries({ queryKey: ['session'] })
    navigate({ to: '/' })
  }

  return (
    <>
      <Tooltip title={t('shell.account')}>
        <Button
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            mt: 1.75,
            justifyContent: 'flex-start',
            gap: 1.25,
            p: 1,
            borderRadius: '11px',
            bgcolor: 'rgba(255,255,255,0.06)',
            color: tokens.paper,
            textAlign: 'start',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.12)' },
          }}
        >
          <Avatar sx={{ width: 30, height: 30, bgcolor: tokens.accentSoft, color: tokens.accentDark, fontSize: 11.5, fontWeight: 700 }}>
            {initials}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>
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
        {ctx.schools.length > 1 &&
          ctx.schools.map((s) => (
            <MenuItem key={s.id} onClick={() => switchTo(s.id)} selected={s.id === ctx.school.id}>
              <ListItemIcon>{s.id === ctx.school.id ? <CheckOutlined fontSize="small" /> : <SwapHorizOutlined fontSize="small" />}</ListItemIcon>
              <ListItemText>{s.name}</ListItemText>
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
