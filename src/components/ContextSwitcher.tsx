import { useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import {
  Box,
  ButtonBase,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material'
import UnfoldMoreOutlined from '@mui/icons-material/UnfoldMoreOutlined'
import CheckOutlined from '@mui/icons-material/CheckOutlined'
import AddOutlined from '@mui/icons-material/AddOutlined'
import { useI18n } from '#/i18n/i18n'
import { rememberSchool, rememberYear, useSchool } from '#/lib/session'
import { YearForm } from '#/features/setup/YearSection'
import { tokens } from '#/theme/theme'

// The block at the top of the sidebar: which school, which school year.
// One click opens both lists, with "add" at the end of each.
export function ContextSwitcher() {
  const { t } = useI18n()
  const ctx = useSchool()
  const router = useRouter()
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [yearOpen, setYearOpen] = useState(false)
  const viewingPast = ctx.year && !ctx.year.is_current

  const pickSchool = async (id: string) => {
    setAnchor(null)
    if (id === ctx.school.id) return
    rememberSchool(id)
    await router.invalidate()
    navigate({ to: '/' })
  }
  const pickYear = async (id: string) => {
    setAnchor(null)
    rememberYear(ctx.school.id, id)
    await router.invalidate()
  }

  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-label={t('switcher.open')}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          p: 0.75,
          mb: 2.25,
          borderRadius: '12px',
          textAlign: 'start',
          '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
          '&:focus-visible': { outline: `2px solid ${tokens.accentLine}` },
        }}
      >
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
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap dir="auto" sx={{ fontSize: 13, fontWeight: 600, color: tokens.paper }}>
            {ctx.school.name}
          </Typography>
          <Typography noWrap sx={{ fontSize: 11, color: viewingPast ? '#E7CFA4' : tokens.sidebarMuted }}>
            {ctx.year ? t('shell.year', { name: ctx.year.name }) : t('shell.noYear')}
            {viewingPast ? ` · ${t('switcher.notCurrent')}` : ''}
          </Typography>
        </Box>
        <UnfoldMoreOutlined sx={{ fontSize: 18, color: tokens.sidebarMuted }} />
      </ButtonBase>

      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { minWidth: 280, maxHeight: 520 } } }}
      >
        <ListSubheader sx={{ lineHeight: '32px', fontWeight: 600 }}>{t('switcher.schools')}</ListSubheader>
        {ctx.schools.map((s) => (
          <MenuItem key={s.id} onClick={() => pickSchool(s.id)} selected={s.id === ctx.school.id}>
            <ListItemIcon>{s.id === ctx.school.id && <CheckOutlined fontSize="small" />}</ListItemIcon>
            <ListItemText primary={s.name} slotProps={{ primary: { dir: 'auto' } }} />
          </MenuItem>
        ))}
        <MenuItem
          onClick={() => {
            setAnchor(null)
            navigate({ to: '/setup', search: { new: true } })
          }}
        >
          <ListItemIcon>
            <AddOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('switcher.addSchool')}</ListItemText>
        </MenuItem>
        <Divider />
        <ListSubheader sx={{ lineHeight: '32px', fontWeight: 600 }}>{t('switcher.years')}</ListSubheader>
        {ctx.years.length === 0 && (
          <MenuItem disabled>
            <ListItemText>{t('year.none')}</ListItemText>
          </MenuItem>
        )}
        {ctx.years.map((y) => (
          <MenuItem key={y.id} onClick={() => pickYear(y.id)} selected={y.id === ctx.year?.id}>
            <ListItemIcon>{y.id === ctx.year?.id && <CheckOutlined fontSize="small" />}</ListItemIcon>
            <ListItemText
              primary={y.name}
              secondary={y.is_current ? t('year.current') : undefined}
            />
          </MenuItem>
        ))}
        {ctx.isAdmin && (
          <MenuItem
            onClick={() => {
              setAnchor(null)
              setYearOpen(true)
            }}
          >
            <ListItemIcon>
              <AddOutlined fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('year.new')}</ListItemText>
          </MenuItem>
        )}
      </Menu>
      <NewYearDialog open={yearOpen} onClose={() => setYearOpen(false)} />
    </>
  )
}

// New school year, from the switcher or the header's quick actions. The new
// year becomes the one being viewed, so its classes can be set up right away.
export function NewYearDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const router = useRouter()
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('year.new')}</DialogTitle>
      <DialogContent>
        <Stack sx={{ pt: 1 }}>
          {open && (
            <YearForm
              schoolId={ctx.school.id}
              years={ctx.years}
              onDone={async (r) => {
                rememberYear(ctx.school.id, r.yearId)
                await router.invalidate()
                onClose()
              }}
            />
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
