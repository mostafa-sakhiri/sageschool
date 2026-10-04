import { useEffect, useState } from 'react'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
import ExpandLessOutlined from '@mui/icons-material/ExpandLessOutlined'
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined'
import { useI18n } from '#/i18n/i18n'
import { formatMinutes } from '#/features/structure/api'
import { TimeField } from '#/components/TimeField'
import { tokens } from '#/theme/theme'
import { PAUSE_KINDS, dayOf, fromMin, teachableMinutes, toMin, weeklyTeachable, type DaySchedule, type Horaire, type Pause } from './schedule'

export function pauseLabel(p: Pause, t: (k: string) => string) {
  return p.label?.trim() || t(`pause.${p.kind}`)
}

// Monday to Saturday, and Sunday when a school opens then
const WEEK = ['1', '2', '3', '4', '5', '6', '7']

const sortPauses = (d: DaySchedule): DaySchedule => ({ ...d, pauses: [...d.pauses].sort((a, b) => toMin(a.start) - toMin(b.start)) })

// One horaire per cycle. With several, a tab per cycle (with its weekly
// total). Controlled: the caller owns the list and decides when to save it.
export function ScheduleEditor({ value, onChange }: { value: Horaire[]; onChange: (v: Horaire[]) => void }) {
  const { t, locale } = useI18n()
  const [openId, setOpenId] = useState<string | null>(null)
  const set = (i: number, h: Horaire) => onChange(value.map((x, j) => (j === i ? h : x)))
  const i = Math.max(0, value.findIndex((h) => h.id === openId))
  const h = value[i]
  if (!h) return null
  const editor = <HoraireEditor key={h.id} h={h} others={value.filter((_, j) => j !== i)} onChange={(x) => set(i, x)} />
  if (value.length === 1) return editor
  return (
    <Box>
      <Tabs
        value={h.id}
        onChange={(_, id) => setOpenId(id)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 2, borderBottom: `1px solid ${tokens.line}` }}
      >
        {value.map((x) => (
          <Tab
            key={x.id}
            value={x.id}
            sx={{ alignItems: 'flex-start', textAlign: 'start' }}
            label={
              <Box>
                <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{x.name || t('sched.allLevels')}</Typography>
                <Typography sx={{ fontSize: 12, color: tokens.inkMuted }}>
                  {x.days.length ? t('sched.perWeek', { week: formatMinutes(weeklyTeachable(x), locale) }) : t('sched.noDays')}
                </Typography>
              </Box>
            }
          />
        ))}
      </Tabs>
      {editor}
    </Box>
  )
}

// A cycle's school day: the typical day first (what most days look like),
// then the week (which days are open, which follow the typical day, which
// have their own), then the roll-call option.
function HoraireEditor({ h, others, onChange }: { h: Horaire; others: Horaire[]; onChange: (h: Horaire) => void }) {
  const { t, locale } = useI18n()
  const dayNames = t('setup.dayNames').split(',')
  const [expanded, setExpanded] = useState<string | null>(null)
  const typicalDays = h.days.filter((d) => !h.overrides[d])
  const weekDays = WEEK.filter((d) => d !== '7' || h.days.includes('7'))

  const setOpen = (d: string, open: boolean) => {
    const overrides = { ...h.overrides }
    if (!open) delete overrides[d]
    onChange({ ...h, days: open ? [...h.days, d].sort() : h.days.filter((x) => x !== d), overrides })
  }
  const customize = (d: string) => {
    onChange({ ...h, overrides: { ...h.overrides, [d]: structuredClone(h.base) } })
    setExpanded(d)
  }
  const backToTypical = (d: string) => {
    const overrides = { ...h.overrides }
    delete overrides[d]
    onChange({ ...h, overrides })
    if (expanded === d) setExpanded(null)
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}>
        <Typography sx={{ flex: 1, fontSize: 14, color: tokens.inkMuted }}>
          {t('sched.summary', { week: formatMinutes(weeklyTeachable(h), locale), days: h.days.length })}
        </Typography>
        {others.length > 0 && (
          <TextField
            select
            size="small"
            label={t('sched.copyFrom')}
            value=""
            onChange={(e) => {
              const src = others.find((o) => o.id === e.target.value)
              if (src) onChange({ ...h, days: [...src.days], base: structuredClone(src.base), overrides: structuredClone(src.overrides), rollCall: src.rollCall })
            }}
            sx={{ minWidth: 220 }}
          >
            {others.map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.name || t('sched.allLevels')}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Typography variant="h5">{t('sched.typicalDay')}</Typography>
        <Typography sx={{ fontSize: 13.5, color: tokens.inkMuted, mb: 2 }}>
          {typicalDays.length
            ? t('sched.typicalAppliesTo', { days: typicalDays.map((d) => dayNames[Number(d) - 1]).join(', ') })
            : t('sched.typicalAppliesNone')}
        </Typography>
        <DayForm day={h.base} onChange={(base) => onChange({ ...h, base })} />
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Typography variant="h5" sx={{ mb: 1 }}>
          {t('sched.week')}
        </Typography>
        <WeekRows
          h={h}
          days={weekDays}
          expanded={expanded}
          onToggleExpand={(d) => setExpanded(expanded === d ? null : d)}
          onOpen={setOpen}
          onCustomize={customize}
          onBack={backToTypical}
          onDayChange={(d, day) => onChange({ ...h, overrides: { ...h.overrides, [d]: day } })}
        />
      </Paper>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, px: 0.5 }}>
        <Typography sx={{ fontWeight: 500, fontSize: 14 }}>{t('sched.rollCall')}</Typography>
        <ToggleButtonGroup exclusive size="small" value={h.rollCall ?? 'session'} onChange={(_, v) => v && onChange({ ...h, rollCall: v })}>
          <ToggleButton value="day">{t('sched.rollCall.day')}</ToggleButton>
          <ToggleButton value="session">{t('sched.rollCall.session')}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
    </Stack>
  )
}

// The week, one line per day: open or closed, the day drawn with its pauses
// named and timed, typical or its own (edited right under its line).
function WeekRows({
  h,
  days,
  expanded,
  onToggleExpand,
  onOpen,
  onCustomize,
  onBack,
  onDayChange,
}: {
  h: Horaire
  days: string[]
  expanded: string | null
  onToggleExpand: (d: string) => void
  onOpen: (d: string, open: boolean) => void
  onCustomize: (d: string) => void
  onBack: (d: string) => void
  onDayChange: (d: string, day: DaySchedule) => void
}) {
  const { t, locale } = useI18n()
  const dayNames = t('setup.dayNames').split(',')
  // One time axis for every day, so the bars line up
  const open = h.days.map((d) => dayOf(h, d)).filter((x): x is DaySchedule => !!x)
  const from = open.length ? Math.min(...open.map((x) => toMin(x.start))) : 8 * 60
  const to = open.length ? Math.max(...open.map((x) => toMin(x.end))) : 17 * 60

  return (
    <Stack divider={<Box sx={{ borderTop: `1px solid ${tokens.lineSoft}` }} />}>
      {days.map((d) => {
        const isOpen = h.days.includes(d)
        const own = isOpen && !!h.overrides[d]
        const day = dayOf(h, d)
        const isExpanded = own && expanded === d
        const name = dayNames[Number(d) - 1]
        return (
          <Box key={d} sx={{ py: 0.75 }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr auto', md: '100px 52px 44px minmax(0, 1fr) 44px 190px 64px' },
                gap: { xs: 1, md: 1.5 },
                alignItems: 'center',
              }}
            >
              <Typography sx={{ fontWeight: 600, fontSize: 14, color: isOpen ? tokens.ink : tokens.inkMuted }}>{name}</Typography>
              <Switch size="small" checked={isOpen} onChange={(e) => onOpen(d, e.target.checked)} slotProps={{ input: { 'aria-label': `${name} — ${t('sched.openDay')}` } }} />
              {isOpen && day ? (
                <>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, display: { xs: 'none', md: 'block' } }}>{day.start}</Typography>
                  <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, minWidth: 0 }}>
                    <DayBar day={day} from={from} to={to} />
                  </Box>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600, display: { xs: 'none', md: 'block' } }}>{day.end}</Typography>
                </>
              ) : (
                <Typography sx={{ fontSize: 13, color: tokens.inkMuted, gridColumn: { xs: '1 / -1', md: 'span 3' } }}>{t('sched.closed')}</Typography>
              )}
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', gridColumn: { xs: '1 / -1', md: 'auto' } }}>
                {isOpen &&
                  (own ? (
                    <>
                      <Chip size="small" color="primary" label={t('sched.ownTag')} />
                      <Button size="small" onClick={() => onToggleExpand(d)} endIcon={isExpanded ? <ExpandLessOutlined /> : <ExpandMoreOutlined />}>
                        {isExpanded ? t('sched.closeEdit') : t('sched.edit')}
                      </Button>
                    </>
                  ) : (
                    <Button size="small" color="inherit" onClick={() => onCustomize(d)} sx={{ color: tokens.inkMuted }}>
                      {t('sched.customizeShort')}
                    </Button>
                  ))}
              </Stack>
              <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted, textAlign: 'end', display: { xs: 'none', md: 'block' } }}>
                {isOpen && day ? formatMinutes(teachableMinutes(day), locale) : ''}
              </Typography>
            </Box>
            {isExpanded && day && (
              <Box sx={{ mt: 1.5, mb: 1, ml: { md: '100px' }, pl: 2, borderInlineStart: `3px solid ${tokens.accentLine}` }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>{t('sched.ownDay', { day: name })}</Typography>
                  <Button size="small" color="inherit" onClick={() => onBack(d)}>
                    {t('sched.resetDay')}
                  </Button>
                </Stack>
                <DayForm day={day} onChange={(x) => onDayChange(d, x)} />
              </Box>
            )}
          </Box>
        )
      })}
    </Stack>
  )
}

// A day drawn on the shared axis, each pause named in its block (its times
// on hover).
function DayBar({ day, from, to }: { day: DaySchedule; from: number; to: number }) {
  const { t } = useI18n()
  const span = Math.max(1, to - from)
  const pct = (m: number) => `${((m - from) / span) * 100}%`
  const width = (a: number, b: number) => `${(Math.max(0, b - a) / span) * 100}%`
  const pauses = [...day.pauses].sort((a, b) => toMin(a.start) - toMin(b.start))
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ position: 'relative', height: 26, bgcolor: tokens.fill, borderRadius: 1 }}>
        <Box
          sx={{
            position: 'absolute',
            insetInlineStart: pct(toMin(day.start)),
            width: width(toMin(day.start), toMin(day.end)),
            top: 0,
            bottom: 0,
            bgcolor: tokens.accentSoft,
            borderRadius: 1,
          }}
        />

        {pauses.map((p, i) => (
          <Tooltip key={i} title={`${pauseLabel(p, t)} · ${p.start}–${p.end}`}>
            <Box
              sx={{
                position: 'absolute',
                insetInlineStart: pct(Math.max(toMin(p.start), from)),
                width: width(toMin(p.start), toMin(p.end)),
                top: 3,
                bottom: 3,
                px: 0.5,
                bgcolor: p.kind === 'nap' ? tokens.napBar : p.kind === 'recess' ? tokens.recessBar : tokens.lineStrong,
                borderRadius: 0.75,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                fontSize: 10.5,
                lineHeight: '20px',
                fontWeight: 600,
                color: tokens.ink,
              }}
            >
              {pauseLabel(p, t)}
            </Box>
          </Tooltip>
        ))}
      </Box>
    </Box>
  )
}

// Where a new pause of a kind lands, given the day (then the user adjusts)
function defaultPause(kind: Pause['kind'], day: DaySchedule): Pause {
  const s = toMin(day.start)
  const e = toMin(day.end)
  const at = (a: number, len: number) => {
    const start = Math.max(s, Math.min(a, e - len))
    return { start: fromMin(start), end: fromMin(Math.min(e, start + len)) }
  }
  const recesses = day.pauses.filter((p) => p.kind === 'recess').length
  switch (kind) {
    case 'welcome':
      return { kind, ...at(s, 15) }
    case 'dismissal':
      return { kind, ...at(e - 15, 15) }
    case 'lunch':
      return { kind, ...at(12 * 60, 90) }
    case 'nap':
      return { kind, ...at(13 * 60 + 30, 90) }
    case 'snack':
      return { kind, ...at(15 * 60 + 30, 15) }
    case 'recess':
      // the morning one first, then the afternoon one
      return { kind, ...at(recesses === 0 ? s + 105 : 15 * 60, 15) }
    case 'care':
      return { kind, ...at(s + 60, 15) }
    default: {
      const last = day.pauses.at(-1)
      return { kind, ...at(last ? toMin(last.end) + 60 : s + 120, 15) }
    }
  }
}

// Opening and pauses of one day. A pause added lands in time order; one
// outside the opening (or ending before it starts) is flagged on its line.
function DayForm({ day, onChange }: { day: DaySchedule; onChange: (d: DaySchedule) => void }) {
  const { t, locale } = useI18n()
  const set = (d: DaySchedule) => onChange(sortPauses(d))
  // (not re-sorted while typing: the row would jump away from the cursor)
  const setPause = (i: number, p: Partial<Pause>) => onChange({ ...day, pauses: day.pauses.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const wrong = (p: Pause) => p.end <= p.start || p.start < day.start || p.end > day.end
  const openWrong = day.end <= day.start
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography sx={{ width: 170, fontWeight: 600, fontSize: 14 }}>{t('sched.opening')}</Typography>
        <TimeField size="small" value={day.start} onChange={(v) => set({ ...day, start: v })} error={openWrong} sx={{ width: 120 }} slotProps={{ htmlInput: { 'aria-label': `${t('sched.opening')} — ${t('setup.start')}` } }} />
        <Typography color="text.secondary">→</Typography>
        <TimeField size="small" value={day.end} onChange={(v) => set({ ...day, end: v })} error={openWrong} sx={{ width: 120 }} slotProps={{ htmlInput: { 'aria-label': `${t('sched.opening')} — ${t('setup.end')}` } }} />
        <Box sx={{ flex: 1 }} />
        <Chip size="small" sx={{ bgcolor: tokens.accentSoft, color: tokens.accentDark, fontWeight: 600 }} label={t('sched.activities', { min: formatMinutes(teachableMinutes(day), locale) })} />
      </Stack>
      <Divider />

      {day.pauses.map((p, i) => (
        <Box key={i}>
          <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <PauseName pause={p} onChange={(x) => setPause(i, x)} />
            <TimeField size="small" value={p.start} onChange={(v) => setPause(i, { start: v })} error={wrong(p)} sx={{ width: 120 }} slotProps={{ htmlInput: { 'aria-label': `${pauseLabel(p, t)} — ${t('setup.start')}` } }} />
            <Typography color="text.secondary">→</Typography>
            <TimeField size="small" value={p.end} onChange={(v) => setPause(i, { end: v })} error={wrong(p)} sx={{ width: 120 }} slotProps={{ htmlInput: { 'aria-label': `${pauseLabel(p, t)} — ${t('setup.end')}` } }} />
            <Box sx={{ flex: 1 }} />
            <Tooltip title={t('common.delete')}>
              <IconButton aria-label={`${t('common.delete')} — ${pauseLabel(p, t)}`} onClick={() => onChange({ ...day, pauses: day.pauses.filter((_, j) => j !== i) })}>
                <DeleteOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          {wrong(p) && (
            <Typography sx={{ fontSize: 12, color: tokens.dangerInk, mt: 0.25, ml: { sm: '232px' } }}>
              {p.end <= p.start ? t('sched.pauseEndsFirst') : t('sched.pauseOutsideDay', { start: day.start, end: day.end })}
            </Typography>
          )}
        </Box>
      ))}
      {day.pauses.length === 0 && <Typography sx={{ color: tokens.inkMuted, fontSize: 13.5 }}>{t('sched.noPause')}</Typography>}

      <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', pt: 0.5 }}>
        <Typography sx={{ fontSize: 13, color: tokens.inkMuted, mr: 0.5 }}>{t('sched.quickAdd')}</Typography>
        {PAUSE_KINDS.map((k) => (
          <Chip key={k} size="small" variant="outlined" icon={<AddOutlined />} label={t(`pause.${k}`)} onClick={() => set({ ...day, pauses: [...day.pauses, defaultPause(k, day)] })} />
        ))}
      </Stack>
      {openWrong && <Alert severity="warning">{t('sched.openingWrong')}</Alert>}
    </Stack>
  )
}

// A pause's name, one field: type to rename it ("Récré du matin"), or pick a
// usual kind from the list. Typing a kind's name exactly makes it that kind;
// any other name keeps the kind (its colour, the nap...) and becomes the label.
function PauseName({ pause, onChange }: { pause: Pause; onChange: (p: Partial<Pause>) => void }) {
  const { t } = useI18n()
  const shown = pauseLabel(pause, t)
  const [text, setText] = useState(shown)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(shown)
  }, [shown, focused])
  const kindNamed = (v: string) => PAUSE_KINDS.find((k) => t(`pause.${k}`).toLowerCase() === v.trim().toLowerCase())
  const apply = (v: string) => {
    const k = kindNamed(v)
    if (k) onChange({ kind: k, label: undefined })
    else onChange({ label: v.trim() || undefined })
  }
  return (
    <Autocomplete
      freeSolo
      disableClearable
      size="small"
      options={PAUSE_KINDS.map((k) => t(`pause.${k}`))}
      // the whole list on opening, not only what matches the current name
      filterOptions={(o) => o}
      inputValue={text}
      onInputChange={(_, v, reason) => {
        setText(v)
        if (reason !== 'reset') apply(v)
      }}
      onChange={(_, v) => {
        if (typeof v === 'string') {
          setText(v)
          apply(v)
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        // emptied: back to the kind's own name
        if (!text.trim()) setText(t(`pause.${pause.kind}`))
      }}
      sx={{ width: 220 }}
      renderInput={(params) => (
        <TextField {...params} slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, 'aria-label': t('sched.pauseName') } }} />
      )}
    />
  )
}
