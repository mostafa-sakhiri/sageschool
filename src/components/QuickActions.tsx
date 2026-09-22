import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import FaceOutlined from '@mui/icons-material/FaceOutlined'
import EventOutlined from '@mui/icons-material/EventOutlined'
import PersonAddOutlined from '@mui/icons-material/PersonAddOutlined'
import CampaignOutlined from '@mui/icons-material/CampaignOutlined'
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined'
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined'
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined'
import ForumOutlined from '@mui/icons-material/ForumOutlined'
import DomainAddOutlined from '@mui/icons-material/DomainAddOutlined'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import { useI18n } from '#/i18n/i18n'
import { useSchool, type Role } from '#/lib/session'
import { AddStudentDialog } from '#/features/students/AddStudentDialog'
import { InviteDialog } from '#/features/team/InviteDialog'
import { NewYearDialog } from './ContextSwitcher'
import { tokens } from '#/theme/theme'

type Dialogs = 'student' | 'year' | 'member' | null

// `dialog`: opens in place (keeps the mobile drawer mounted, or the dialog
// would unmount with it); `to`: goes to a page, `new` opening its dialog.
type Action = {
  key: string
  icon: React.ReactNode
  roles: Role[]
  dialog?: Exclude<Dialogs, null>
  to?: string
  new?: boolean
  importParam?: boolean
}

// Most frequent actions per role, one click from any page. Dialogs open in
// place; the rest go to the page with its creation dialog already open.
const ACTIONS: Action[] = [
  { key: 'quick.enroll', icon: <FaceOutlined fontSize="small" />, roles: ['admin', 'staff'], dialog: 'student' },
  { key: 'quick.importStudents', icon: <UploadFileOutlined fontSize="small" />, roles: ['admin', 'staff'], to: '/students', importParam: true },
  { key: 'quick.attendance', icon: <FactCheckOutlined fontSize="small" />, roles: ['admin', 'staff', 'teacher'], to: '/attendance' },
  { key: 'quick.homework', icon: <MenuBookOutlined fontSize="small" />, roles: ['teacher'], to: '/homework', new: true },
  { key: 'quick.announcement', icon: <CampaignOutlined fontSize="small" />, roles: ['admin', 'staff'], to: '/announcements', new: true },
  { key: 'quick.payment', icon: <PaymentsOutlined fontSize="small" />, roles: ['admin', 'staff'], to: '/fees' },
  { key: 'quick.writeSchool', icon: <ForumOutlined fontSize="small" />, roles: ['parent'], to: '/cases', new: true },
  { key: 'quick.justify', icon: <FactCheckOutlined fontSize="small" />, roles: ['parent'], to: '/attendance' },
  { key: 'quick.member', icon: <PersonAddOutlined fontSize="small" />, roles: ['admin'], dialog: 'member' },
  { key: 'quick.importStaff', icon: <UploadFileOutlined fontSize="small" />, roles: ['admin'], to: '/team', importParam: true },
  { key: 'quick.year', icon: <EventOutlined fontSize="small" />, roles: ['admin'], dialog: 'year' },
  { key: 'quick.school', icon: <DomainAddOutlined fontSize="small" />, roles: ['admin'], to: '/setup', new: true },
]

// Lives in the sidebar, under the school/year switcher. `onDone` closes the
// mobile drawer once an action is chosen.
export function QuickActions({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [dialog, setDialog] = useState<Dialogs>(null)

  const actions = ACTIONS.filter((a) => a.roles.includes(ctx.role))
  if (!actions.length) return null

  const run = (a: Action) => {
    setAnchor(null)
    if (a.dialog) return setDialog(a.dialog)
    navigate({ to: a.to!, search: a.new ? { new: true } : a.importParam ? { import: true } : {} } as never)
    onDone?.()
  }

  return (
    <>
      <Button
        fullWidth
        variant="contained"
        startIcon={<AddOutlined />}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        sx={{
          mb: 2,
          justifyContent: 'flex-start',
          px: 1.5,
          bgcolor: tokens.accent,
          '&:hover': { bgcolor: tokens.accentDark },
        }}
      >
        {t('quick.new')}
      </Button>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { minWidth: 250 } } }}
      >
        {actions.map((a) => (
          <MenuItem
            key={a.key}
            onClick={() => run(a)}
          >
            <ListItemIcon>{a.icon}</ListItemIcon>
            <ListItemText>{t(a.key)}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
      <AddStudentDialog open={dialog === 'student'} onClose={() => setDialog(null)} onCreated={() => navigate({ to: '/students' })} />
      <NewYearDialog open={dialog === 'year'} onClose={() => setDialog(null)} />
      {dialog === 'member' && (
        <InviteDialog
          open
          onClose={() => setDialog(null)}
          schoolId={ctx.school.id}
          roles={['teacher', 'staff', 'admin']}
          title={t('team.add')}
        />
      )}
    </>
  )
}
