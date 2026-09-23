import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import AddOutlined from '@mui/icons-material/AddOutlined'
import DeleteOutlined from '@mui/icons-material/DeleteOutlined'
import { useI18n } from '#/i18n/i18n'
import { formatMinutes } from '#/features/structure/api'
import { tokens } from '#/theme/theme'
import {
  PAUSE_KINDS,
  WEEKDAYS,
  dayOf,
  fromMin,
  teachableMinutes,
  toMin,
  weeklyTeachable,
  type DaySchedule,
  type Horaire,
  type Pause,
} from './schedule'

export function pauseLabel(p: Pause, t: (k: string) => string) {
  return p.label?.trim() || t(`pause.${p.kind}`)
}

// One card per horaire (usually one per cycle). Controlled: the caller owns
// the list and decides when to save it.
export function ScheduleEditor({ value, onChange }: { value: Horaire[]; onChange: (v: Horaire[]) => void }) {
  const set = (i: number, h: Horaire) => onChange(value.map((x, j) => (j === i ? h : x)))
  return (
    <Stack spacing={2}>
      {value.map((h, i) => (
        <HoraireCard key={h.id} h={h} others={value.filter((_, j) => j !== i)} onChange={(x) => set(i, x)} />
      ))}
    </Stack>
  )
}

function HoraireCard({ h, others, onChange }: { h: Horaire; others: Horaire[]; onChange: (h: Horaire) => void }) {
  const { t, locale } = useI18n()
  const [sel, setSel] = useState<string>('base')
  const dayNames = t('setup.dayNames').split(',')
  const shortNames = dayNames.map((d) => d.slice(0, 3))
  const week = weeklyTeachable(h)
  const current = sel !== 'base' && h.days.includes(sel) ? sel : 'base'
  const custom = current !== 'base' && !!h.overrides[current]
  const shown: DaySchedule = current === 'base' ? h.base : (h.overrides[current] ?? h.base)

  const setDay = (d: DaySchedule) =>
    current === 'base' ? onChange({ ...h, base: d }) : onChange({ ...h, overrides: { ...h.overrides, [current]: d } })
  const toggleDay = (d: string) => {
    const on = h.days.includes(d)
    const overrides = { ...h.overrides }
    if (on) delete overrides[d]
    onChange({ ...h, days: on ? h.days.filter((x) => x !== d) : [...h.days, d].sort(), overrides })
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' }, mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">{h.name || t('sched.allLevels')}</Typography>
          <Typography sx={{ fontSize: 13.5, color: tokens.inkMuted }}>
            {t('sched.summary', { week: formatMinutes(week, locale), days: h.days.length })}
          </Typography>
        </Box>
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
            sx={{ minWidth: 200 }}
          >
            {others.map((o) => (
              <MenuItem key={o.id} value={o.id}>
                {o.name || t('sched.allLevels')}
              </MenuItem>
            ))}
          </TextField>
        )}
      </Stack>

      <Typography variant="h6" sx={{ mb: 1 }}>
        {t('setup.days')}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 2 }}>
        {WEEKDAYS.map((d, i) => {
          const on = h.days.includes(d)
          return (
            <Chip
              key={d}
              label={dayNames[i]}
              color={on ? 'primary' : 'default'}
              variant={on ? 'filled' : 'outlined'}
              onClick={() => toggleDay(d)}
              aria-pressed={on}
            />
          )
        })}
      </Stack>

      <WeekPreview h={h} onPick={setSel} selected={current} />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ alignItems: { md: 'center' }, mt: 2, mb: 1.5 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={current}
          onChange={(_, v) => v && setSel(v)}
          sx={{ flexWrap: 'wrap' }}
          aria-label={t('sched.editDay')}
        >
          <ToggleButton value="base">{t('sched.typicalDay')}</ToggleButton>
          {h.days.map((d) => (
            <ToggleButton key={d} value={d}>
              {shortNames[Number(d) - 1]}
              {h.overrides[d] ? ' •' : ''}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        {current !== 'base' &&
          (custom ? (
            <Button
              size="small"
              onClick={() => {
                const overrides = { ...h.overrides }
                delete overrides[current]
                onChange({ ...h, overrides })
              }}
            >
              {t('sched.resetDay')}
            </Button>
          ) : (
            <Button
              size="small"
              variant="outlined"
              onClick={() => onChange({ ...h, overrides: { ...h.overrides, [current]: structuredClone(h.base) } })}
            >
              {t('sched.customize', { day: dayNames[Number(current) - 1] })}
            </Button>
          ))}
      </Stack>

      {current !== 'base' && !custom ? (
        <Typography sx={{ color: tokens.inkMuted, fontSize: 14, py: 1 }}>
          {t('sched.sameAsTypical', { day: dayNames[Number(current) - 1] })}
        </Typography>
      ) : (
        <DayEditor day={shown} onChange={setDay} />
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, mt: 2 }}>
        <Typography sx={{ fontWeight: 500, fontSize: 14 }}>{t('sched.rollCall')}</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={h.rollCall ?? 'session'}
          onChange={(_, v) => v && onChange({ ...h, rollCall: v })}
        >
          <ToggleButton value="day">{t('sched.rollCall.day')}</ToggleButton>
          <ToggleButton value="session">{t('sched.rollCall.session')}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
    </Paper>
  )
}

function DayEditor({ day, onChange }: { day: DaySchedule; onChange: (d: DaySchedule) => void }) {
  const { t, locale } = useI18n()
  const setPause = (i: number, p: Partial<Pause>) =>
    onChange({ ...day, pauses: day.pauses.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const addPause = () => {
    // Next to the last pause, or mid-morning for the first one
    const last = day.pauses[day.pauses.length - 1]
    const s = last ? Math.min(toMin(last.end) + 60, toMin(day.end) - 15) : toMin(day.start) + 105
    onChange({ ...day, pauses: [...day.pauses, { kind: 'recess', start: fromMin(s), end: fromMin(s + 15) }] })
  }
  const teach = teachableMinutes(day)
  const bad = day.pauses.some((p) => p.end <= p.start || p.start < day.start || p.end > day.end)
  const time = (label: string, v: string, set: (v: string) => void) => (
    <TextField
      type="time"
      size="small"
      label={label}
      value={v}
      onChange={(e) => set(e.target.value)}
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { step: 300 } }}
      sx={{ width: 130 }}
    />
  )
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography sx={{ width: 150, fontWeight: 500 }}>{t('sched.opening')}</Typography>
        {time(t('setup.start'), day.start, (v) => onChange({ ...day, start: v }))}
        {time(t('setup.end'), day.end, (v) => onChange({ ...day, end: v }))}
      </Stack>
      <Typography variant="h6">{t('sched.pauses')}</Typography>
      {day.pauses.length === 0 && <Typography sx={{ color: tokens.inkMuted, fontSize: 14 }}>{t('sched.noPause')}</Typography>}
      {day.pauses.map((p, i) => (
        <Stack key={i} direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            select
            size="small"
            label={t('sched.kind')}
            value={p.kind}
            onChange={(e) => setPause(i, { kind: e.target.value as Pause['kind'] })}
            sx={{ width: 190 }}
          >
            {PAUSE_KINDS.map((k) => (
              <MenuItem key={k} value={k}>
                {t(`pause.${k}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label={t('sched.label')}
            placeholder={t(`pause.${p.kind}`)}
            value={p.label ?? ''}
            onChange={(e) => setPause(i, { label: e.target.value || undefined })}
            sx={{ flex: '1 1 180px', minWidth: 160 }}
          />
          {time(t('setup.start'), p.start, (v) => setPause(i, { start: v }))}
          {time(t('setup.end'), p.end, (v) => setPause(i, { end: v }))}
          <Tooltip title={t('common.delete')}>
            <IconButton
              aria-label={t('common.delete')}
              onClick={() => onChange({ ...day, pauses: day.pauses.filter((_, j) => j !== i) })}
            >
              <DeleteOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ))}
      <Button startIcon={<AddOutlined />} onClick={addPause} sx={{ alignSelf: 'flex-start' }}>
        {t('sched.addPause')}
      </Button>
      {bad && <Alert severity="warning">{t('sched.pauseOutside')}</Alert>}
      <Alert severity="success" icon={false} sx={{ bgcolor: tokens.accentSoft, color: tokens.accentDark }}>
        {t('sched.teachableDay', { min: formatMinutes(teach, locale) })}
      </Alert>
    </Stack>
  )
}

// The week at a glance: one bar per open day, pauses shaded. Clicking a day
// selects it for editing.
function WeekPreview({ h, onPick, selected }: { h: Horaire; onPick: (d: string) => void; selected: string }) {
  const { t, locale } = useI18n()
  const dayNames = t('setup.dayNames').split(',')
  if (!h.days.length) return null
  const days = h.days.map((d) => ({ d, day: dayOf(h, d)! }))
  const from = Math.min(...days.map((x) => toMin(x.day.start)))
  const to = Math.max(...days.map((x) => toMin(x.day.end)))
  const span = Math.max(1, to - from)
  const pct = (m: number) => `${((m - from) / span) * 100}%`
  return (
    <Box sx={{ border: `1px solid ${tokens.lineSoft}`, borderRadius: 2, p: 1.25, bgcolor: tokens.cardWarm }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', pl: '92px', mb: 0.5 }}>
        <Typography sx={{ fontSize: 11, color: tokens.inkMuted }}>{fromMin(from)}</Typography>
        <Typography sx={{ fontSize: 11, color: tokens.inkMuted }}>{fromMin(to)}</Typography>
      </Stack>
      <Stack spacing={0.75}>
        {days.map(({ d, day }) => (
          <Stack
            key={d}
            direction="row"
            spacing={1}
            onClick={() => onPick(d)}
            sx={{ alignItems: 'center', cursor: 'pointer', borderRadius: 1, outline: selected === d ? `2px solid ${tokens.accentLine}` : 'none' }}
          >
            <Typography sx={{ width: 84, fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}>
              {dayNames[Number(d) - 1]}
              {h.overrides[d] ? ' •' : ''}
            </Typography>
            <Box sx={{ position: 'relative', flex: 1, height: 22, bgcolor: tokens.paper, borderRadius: 1 }}>
              <Box
                sx={{
                  position: 'absolute',
                  insetInlineStart: pct(toMin(day.start)),
                  width: `${((toMin(day.end) - toMin(day.start)) / span) * 100}%`,
                  top: 0,
                  bottom: 0,
                  bgcolor: tokens.accentSoft,
                  borderRadius: 1,
                }}
              />
              {day.pauses.map((p, i) => (
                <Tooltip key={i} title={`${pauseLabel(p, t)} · ${p.start}–${p.end}`}>
                  <Box
                    sx={{
                      position: 'absolute',
                      insetInlineStart: pct(Math.max(toMin(p.start), from)),
                      width: `${(Math.max(0, toMin(p.end) - toMin(p.start)) / span) * 100}%`,
                      top: 3,
                      bottom: 3,
                      bgcolor: p.kind === 'nap' ? '#D9D3E8' : p.kind === 'recess' ? '#F1DDB6' : tokens.lineStrong,
                      borderRadius: 0.75,
                    }}
                  />
                </Tooltip>
              ))}
            </Box>
            <Typography sx={{ width: 64, fontSize: 12, color: tokens.inkMuted, textAlign: 'end', flexShrink: 0 }}>
              {formatMinutes(teachableMinutes(day), locale)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}
