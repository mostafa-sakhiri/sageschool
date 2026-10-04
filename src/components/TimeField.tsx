import { useEffect, useRef, useState } from 'react'
import { Box, ButtonBase, IconButton, InputAdornment, Paper, Popper, TextField, type TextFieldProps } from '@mui/material'
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined'
import { tokens } from '#/theme/theme'

// Reads what was typed as a 24-hour time: "14:30", "14h30", "1430", "830",
// "8" (→ 08:00). Null when it isn't one (yet).
export function parseTime(text: string): string | null {
  const s = text.trim()
  if (!s) return null
  let h: number
  let m: number
  const sep = s.match(/^(\d{1,2})\s*[:hH.]\s*(\d{0,2})$/)
  if (sep) {
    h = Number(sep[1])
    m = Number(sep[2] || 0)
  } else if (/^\d{1,4}$/.test(s)) {
    if (s.length <= 2) [h, m] = [Number(s), 0]
    else [h, m] = [Number(s.slice(0, s.length - 2)), Number(s.slice(-2))]
  } else return null
  if (h > 23 || m > 59) return null
  return `${pad(h)}:${pad(m)}`
}

const pad = (n: number) => String(n).padStart(2, '0')

function shift(v: string, minutes: number) {
  const [h, m] = v.split(':').map(Number)
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`
}

type Props = Omit<TextFieldProps, 'value' | 'onChange' | 'type'> & {
  // "HH:MM", or '' for none
  value: string
  onChange: (value: string) => void
  // ↑ / ↓ step and the picker's minutes, in minutes
  step?: number
}

// A 24-hour time field (Morocco writes 14:00, never 2 PM), whatever the
// browser's language: the native time input would follow it. Click it for a
// picker (hours | minutes), or type "1430" / "14h30"; ↑ / ↓ move by `step`.
// `onChange` gets a full "HH:MM" (or '' when emptied), never a half-typed value.
export function TimeField({ value, onChange, step = 5, slotProps, onBlur, disabled, ...rest }: Props) {
  const [text, setText] = useState(value)
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focused) setText(value)
  }, [value, focused])

  const commit = (raw: string) => {
    if (!raw.trim()) {
      setText('')
      if (value) onChange('')
      return
    }
    const v = parseTime(raw)
    if (v) {
      setText(v)
      if (v !== value) onChange(v)
    } else setText(value)
  }
  const pick = (v: string) => {
    setText(v)
    if (v !== value) onChange(v)
  }

  return (
    <>
      <TextField
        {...rest}
        ref={anchor}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d:hH.\s]/g, '').slice(0, 5)
          setText(raw)
          // A complete time is passed on at once ("14:30", "1430")
          if (/^\d{4}$/.test(raw) || /^\d{1,2}\s*[:hH.]\s*\d{2}$/.test(raw)) {
            const v = parseTime(raw)
            if (v && v !== value) onChange(v)
          } else if (!raw) onChange('')
        }}
        onClick={() => !disabled && setOpen(true)}
        onFocus={(e) => {
          setFocused(true)
          e.target.select()
        }}
        onBlur={(e) => {
          setFocused(false)
          setOpen(false)
          commit(text)
          onBlur?.(e)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') setOpen(false)
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          const base = parseTime(text) ?? value
          pick(base ? shift(base, e.key === 'ArrowUp' ? step : -step) : '08:00')
        }}
        slotProps={{
          ...slotProps,
          input: {
            endAdornment: (
              <InputAdornment position="end" sx={{ ml: 0 }}>
                <IconButton
                  size="small"
                  edge="end"
                  tabIndex={-1}
                  disabled={disabled}
                  aria-hidden
                  // keep the focus in the field
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpen((o) => !o)
                    anchor.current?.querySelector('input')?.focus()
                  }}
                >
                  <ScheduleOutlined sx={{ fontSize: 17 }} />
                </IconButton>
              </InputAdornment>
            ),
            ...(slotProps?.input as object),
          },
          htmlInput: {
            inputMode: 'numeric',
            placeholder: '--:--',
            autoComplete: 'off',
            dir: 'ltr',
            ...(slotProps?.htmlInput as object),
          },
        }}
      />
      <Popper open={open} anchorEl={anchor.current} placement="bottom-start" sx={{ zIndex: 1500 }}>
        <TimePicker value={parseTime(text) ?? value} step={step} onPick={pick} onDone={() => setOpen(false)} />
      </Popper>
    </>
  )
}

// Two columns, hours then minutes, like the native picker but always 24 h.
// Mouse down is cancelled so the field keeps the focus (and its blur logic).
function TimePicker({ value, step, onPick, onDone }: { value: string; step: number; onPick: (v: string) => void; onDone: () => void }) {
  const [h, m] = value ? value.split(':').map(Number) : [null, null]
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step)
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const hourCol = useRef<HTMLDivElement>(null)
  const minCol = useRef<HTMLDivElement>(null)
  // Show the current value, not midnight
  useEffect(() => {
    hourCol.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
    minCol.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
  }, [])
  const cell = (label: string, on: boolean, onClick: () => void) => (
    <ButtonBase
      key={label}
      role="option"
      aria-selected={on}
      onClick={onClick}
      sx={{
        width: '100%',
        py: 0.6,
        borderRadius: '6px',
        fontSize: 14,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: on ? 600 : 400,
        color: on ? tokens.accentDark : tokens.ink,
        bgcolor: on ? tokens.accentSoft : 'transparent',
        '&:hover': { bgcolor: on ? tokens.accentSoft : tokens.fill },
      }}
    >
      {label}
    </ButtonBase>
  )
  const col = { width: 56, maxHeight: 240, overflowY: 'auto', p: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25 } as const
  return (
    <Paper elevation={6} onMouseDown={(e) => e.preventDefault()} sx={{ display: 'flex', mt: 0.5, border: `1px solid ${tokens.line}` }} dir="ltr">
      <Box ref={hourCol} role="listbox" sx={{ ...col, borderRight: `1px solid ${tokens.lineSoft}` }}>
        {hours.map((x) => cell(pad(x), x === h, () => onPick(`${pad(x)}:${pad(m ?? 0)}`)))}
      </Box>
      <Box ref={minCol} role="listbox" sx={col}>
        {minutes.map((x) =>
          cell(pad(x), x === m, () => {
            onPick(`${pad(h ?? 8)}:${pad(x)}`)
            onDone()
          }),
        )}
      </Box>
    </Paper>
  )
}
