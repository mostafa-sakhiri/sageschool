import { useState } from 'react'
import { Button, IconButton, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material'
import WhatsAppIcon from '@mui/icons-material/WhatsApp'
import { useI18n } from '#/i18n/i18n'
import { formatPhone, normalizePhone } from '#/lib/format'

// WhatsApp without an API: a wa.me link opens the sender's own WhatsApp (app
// or web) with the message written; they press send themselves. Nothing leaves
// the school automatically, nothing needs Meta's approval.
export function waLink(phone: string | null | undefined, text: string) {
  const digits = normalizePhone(phone).replace(/^\+/, '')
  if (!digits) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

export function openWhatsApp(phone: string | null | undefined, text: string) {
  const url = waLink(phone, text)
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
  return !!url
}

const GREEN = '#25D366'

// One recipient. `onSent` runs when the link is opened (e.g. mark the parent
// as notified, log a reminder): the sender may still cancel in WhatsApp.
export function WhatsAppButton({
  phone,
  text,
  label,
  tooltip,
  onSent,
  size = 'small',
}: {
  phone: string | null | undefined
  text: string
  label?: string
  tooltip?: string
  onSent?: () => void
  size?: 'small' | 'medium'
}) {
  const { t } = useI18n()
  if (!waLink(phone, text)) return null
  const open = () => {
    if (openWhatsApp(phone, text)) onSent?.()
  }
  const title = tooltip ?? t('wa.openTo', { phone: formatPhone(normalizePhone(phone)) })
  if (label)
    return (
      <Tooltip title={title}>
        <Button size={size} variant="outlined" startIcon={<WhatsAppIcon sx={{ color: GREEN }} />} onClick={open}>
          {label}
        </Button>
      </Tooltip>
    )
  return (
    <Tooltip title={title}>
      <IconButton size={size} aria-label={title} onClick={open} sx={{ color: GREEN, '&:hover': { color: GREEN } }}>
        <WhatsAppIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  )
}

export type WaRecipient = { name: string; phone: string | null | undefined }

// A student's parents: one parent with a phone -> a direct button; several ->
// a small menu to pick who to write to. `text(name)` builds the message.
export function WhatsAppParents({
  parents,
  text,
  label,
  onSent,
}: {
  parents: WaRecipient[]
  text: (name: string) => string
  label?: string
  onSent?: () => void
}) {
  const { t } = useI18n()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const reachable = parents.filter((p) => waLink(p.phone, 'x'))
  if (reachable.length === 0)
    return (
      <Tooltip title={t('wa.noPhone')}>
        <span>
          {label ? (
            <Button size="small" variant="outlined" disabled startIcon={<WhatsAppIcon />}>
              {label}
            </Button>
          ) : (
            <IconButton size="small" disabled aria-label={t('wa.noPhone')}>
              <WhatsAppIcon fontSize="small" />
            </IconButton>
          )}
        </span>
      </Tooltip>
    )
  if (reachable.length === 1) {
    const p = reachable[0]
    return <WhatsAppButton phone={p.phone} text={text(p.name)} label={label} tooltip={t('wa.writeTo', { name: p.name })} onSent={onSent} />
  }
  return (
    <>
      {label ? (
        <Button size="small" variant="outlined" startIcon={<WhatsAppIcon sx={{ color: GREEN }} />} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu">
          {label}
        </Button>
      ) : (
        <Tooltip title={t('wa.pickParent')}>
          <IconButton size="small" aria-label={t('wa.pickParent')} onClick={(e) => setAnchor(e.currentTarget)} sx={{ color: GREEN }}>
            <WhatsAppIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {reachable.map((p) => (
          <MenuItem
            key={`${p.name}-${p.phone}`}
            onClick={() => {
              setAnchor(null)
              if (openWhatsApp(p.phone, text(p.name))) onSent?.()
            }}
          >
            <WhatsAppIcon fontSize="small" sx={{ color: GREEN, mr: 1.5 }} />
            <ListItemText primary={p.name} secondary={formatPhone(normalizePhone(p.phone))} slotProps={{ secondary: { dir: 'ltr', sx: { textAlign: 'start' } } }} />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

// Guardians as returned by studentsQuery -> recipients
export function guardiansToRecipients(guardians: { member: { user: { full_name: string; phone: string | null } | null } | null }[]): WaRecipient[] {
  return guardians.flatMap((g) => (g.member?.user ? [{ name: g.member.user.full_name, phone: g.member.user.phone }] : []))
}
