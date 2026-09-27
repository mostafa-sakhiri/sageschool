import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRouterState } from '@tanstack/react-router'
import { Alert, Box, Chip, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import CloseOutlined from '@mui/icons-material/CloseOutlined'
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined'
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined'
import StopOutlined from '@mui/icons-material/StopOutlined'
import OpenInFullOutlined from '@mui/icons-material/OpenInFullOutlined'
import CloseFullscreenOutlined from '@mui/icons-material/CloseFullscreenOutlined'
import { useAgent, useRenderToolCall, UseAgentUpdate } from '@copilotkit/react-core/v2'
import { useI18n } from '#/i18n/i18n'
import { tokens } from '#/theme/theme'
import { PANEL_WIDE, PANEL_WIDTH, useAssistantUi } from './shell'

type Msg = {
  id: string
  role: string
  content?: unknown
  toolCalls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  toolCallId?: string
}

// The chat: messages, cards rendered by the tools, and the composer. Always
// mounted (hidden when closed) so a card being filled keeps its state.
export function AssistantPanel() {
  const ui = useAssistantUi()!
  const { t, dir } = useI18n()
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const { agent } = useAgent({ updates: [UseAgentUpdate.OnMessagesChanged, UseAgentUpdate.OnRunStatusChanged] })
  const messages = agent.messages as unknown as Msg[]
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, ui.busy])
  useEffect(() => {
    if (ui.open) input.current?.focus()
  }, [ui.open])

  const send = () => {
    if (!draft.trim() || ui.busy) return
    ui.ask(draft)
    setDraft('')
  }
  const last = messages[messages.length - 1]
  // Nothing visible yet from this run: waiting, reasoning (a "reasoning"
  // message, not shown), or between a tool's result and the reply
  const thinking =
    ui.busy &&
    (!last || last.role !== 'assistant' || (!textOf(last.content) && !last.toolCalls?.length))

  // Desktop: a column of the page (AppShell docks it), not a layer above it.
  // Phone, or a page without the app shell: full-screen, over the page.
  const inline = desktop && ui.docked && !!ui.panelNode
  const panel = (
    <Box
      component="aside"
      aria-label={t('assistant.title')}
      data-assistant-panel
      sx={{
        ...(inline
          ? { position: 'relative', height: '100%', width: '100%' }
          : { position: 'fixed', top: 0, bottom: 0, insetInlineEnd: 0, width: desktop ? ui.width : '100%', zIndex: theme.zIndex.drawer, boxShadow: tokens.shadowLg }),
        bgcolor: tokens.paper,
        borderInlineStart: `1px solid ${tokens.line}`,
        display: ui.open ? 'flex' : 'none',
        flexDirection: 'column',
      }}
    >
      {desktop && <ResizeHandle />}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: 2, height: 52, borderBottom: `1px solid ${tokens.line}`, flexShrink: 0 }}>
        <AutoAwesomeOutlined sx={{ fontSize: 18, color: tokens.accent }} />
        <Typography sx={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{t('assistant.title')}</Typography>
        {desktop && (
          <Tooltip title={ui.width > PANEL_WIDTH ? t('assistant.narrow') : t('assistant.widen')}>
            <IconButton
              size="small"
              onClick={() => ui.setWidth(ui.width > PANEL_WIDTH ? PANEL_WIDTH : PANEL_WIDE)}
              aria-label={ui.width > PANEL_WIDTH ? t('assistant.narrow') : t('assistant.widen')}
            >
              {ui.width > PANEL_WIDTH ? <CloseFullscreenOutlined fontSize="small" /> : <OpenInFullOutlined fontSize="small" sx={{ transform: dir === 'rtl' ? 'scaleX(-1)' : undefined }} />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t('assistant.newChat')}>
          <span>
            <IconButton size="small" onClick={ui.clear} disabled={!messages.length} aria-label={t('assistant.newChat')}>
              <EditNoteOutlined fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <IconButton size="small" onClick={() => ui.setOpen(false)} aria-label={t('common.close')}>
          <CloseOutlined fontSize="small" />
        </IconButton>
      </Stack>

      <Box ref={scroller} sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
        {messages.length === 0 ? (
          <Welcome onPick={(s) => ui.ask(s)} />
        ) : (
          <Stack spacing={1.5}>
            {messages.map((m) => (
              <Fragment key={m.id}>
                <MessageView m={m} all={messages} />
              </Fragment>
            ))}
            {thinking && (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: tokens.inkMuted }}>
                <CircularProgress size={14} />
                <Typography sx={{ fontSize: 13 }}>{t('assistant.thinking')}</Typography>
              </Stack>
            )}
          </Stack>
        )}
        {ui.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {t('assistant.unavailable')}
            <Typography dir="auto" sx={{ fontSize: 12, mt: 0.5, opacity: 0.8 }}>
              {ui.error}
            </Typography>
          </Alert>
        )}
      </Box>

      <Box sx={{ p: 1.5, borderTop: `1px solid ${tokens.line}`, flexShrink: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 1,
            p: 0.75,
            pl: 1.5,
            border: `1px solid ${tokens.lineStrong}`,
            borderRadius: 3,
            bgcolor: tokens.surface,
            '&:focus-within': { borderColor: tokens.accent },
          }}
        >
          <TextField
            inputRef={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={ui.busy ? t('assistant.waitCard') : t('assistant.placeholder')}
            multiline
            maxRows={5}
            fullWidth
            variant="standard"
            slotProps={{ input: { disableUnderline: true, sx: { fontSize: 14, py: 0.5 } }, htmlInput: { dir: 'auto', 'aria-label': t('assistant.placeholder') } }}
          />
          {ui.busy ? (
            <Tooltip title={t('assistant.stop')}>
              <IconButton size="small" onClick={ui.stop} aria-label={t('assistant.stop')} sx={{ bgcolor: tokens.fill }}>
                <StopOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <IconButton
              size="small"
              onClick={send}
              disabled={!draft.trim()}
              aria-label={t('assistant.send')}
              sx={{ bgcolor: tokens.accent, color: '#fff', '&:hover': { bgcolor: tokens.accentHover }, '&.Mui-disabled': { bgcolor: tokens.fill } }}
            >
              <ArrowUpwardOutlined fontSize="small" />
            </IconButton>
          )}
        </Box>
        <Typography sx={{ fontSize: 11, color: tokens.inkMuted, mt: 0.75, px: 0.5 }}>{t('assistant.disclaimer')}</Typography>
      </Box>
    </Box>
  )
  if (inline) return createPortal(panel, ui.panelNode!)
  // Desktop page without the app shell (installation wizard): no column, and
  // an open-by-default panel must not cover it
  if (desktop) return null
  return panel
}

// The panel's inner edge: drag to resize, double-click for normal / wide.
// The panel sits on the inline end, so in RTL it grows to the right.
function ResizeHandle() {
  const ui = useAssistantUi()!
  const { t, dir } = useI18n()
  const [dragging, setDragging] = useState(false)
  const widthAt = (el: Element, x: number) => {
    const r = el.closest('[data-assistant-panel]')!.getBoundingClientRect()
    return dir === 'rtl' ? x - r.left : r.right - x
  }
  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label={t('assistant.resize')}
      aria-valuenow={ui.width}
      tabIndex={0}
      title={t('assistant.resize')}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
      }}
      onPointerMove={(e) => dragging && ui.setWidth(widthAt(e.currentTarget, e.clientX))}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => ui.setWidth(ui.width > PANEL_WIDTH ? PANEL_WIDTH : PANEL_WIDE)}
      onKeyDown={(e) => {
        const grow = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
        const shrink = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
        if (e.key === grow) ui.setWidth(ui.width + 40)
        else if (e.key === shrink) ui.setWidth(ui.width - 40)
        else return
        e.preventDefault()
      }}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        insetInlineStart: -4,
        width: 8,
        cursor: 'col-resize',
        zIndex: 1,
        touchAction: 'none',
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          insetInlineStart: 3,
          width: 2,
          bgcolor: dragging ? tokens.accent : 'transparent',
          transition: 'background-color 120ms',
        },
        '&:hover::after, &:focus-visible::after': { bgcolor: tokens.accentLine },
        '&:focus-visible': { outline: 'none' },
      }}
    />
  )
}

function Welcome({ onPick }: { onPick: (s: string) => void }) {
  const { t } = useI18n()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const keys = pathname.startsWith('/timetable') ? ['assistant.ex.ttMove', 'assistant.ex.ttWhy', 'assistant.ex.ttAdd'] : ['assistant.ex.enroll', 'assistant.ex.visit', 'assistant.ex.announce']
  return (
    <Box sx={{ pt: 2 }}>
      <Typography sx={{ fontWeight: 600, fontSize: 15, mb: 0.5 }}>{t('assistant.welcome')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {pathname.startsWith('/timetable') ? t('assistant.welcomeTimetable') : t('assistant.welcomeHint')}
      </Typography>
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        {keys.map((k) => (
          <Chip key={k} label={t(k)} onClick={() => onPick(t(k))} variant="outlined" sx={{ height: 'auto', py: 0.75, '& .MuiChip-label': { whiteSpace: 'normal' } }} />
        ))}
      </Stack>
    </Box>
  )
}

function MessageView({ m, all }: { m: Msg; all: Msg[] }) {
  const renderToolCall = useRenderToolCall()
  if (m.role === 'user')
    return (
      <Box sx={{ alignSelf: 'flex-end', maxWidth: '85%', ml: 'auto', px: 1.5, py: 1, borderRadius: 3, bgcolor: tokens.accentSoft, color: tokens.ink }}>
        <Typography dir="auto" sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>
          {textOf(m.content)}
        </Typography>
      </Box>
    )
  if (m.role !== 'assistant') return null
  const text = textOf(m.content)
  return (
    <Stack spacing={1}>
      {text && <RichText text={text} />}
      {(m.toolCalls ?? []).map((tc) => {
        const toolMessage = all.find((x) => x.role === 'tool' && x.toolCallId === tc.id)
        return (
          <Box key={tc.id}>
            {renderToolCall({ toolCall: tc, toolMessage: toolMessage as never })}
          </Box>
        )
      })}
    </Stack>
  )
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('')
  return ''
}

// Just enough markdown for short replies: paragraphs, "- " bullets, **bold**.
function RichText({ text }: { text: string }) {
  const lines = text.trim().split('\n')
  const out: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (!bullets.length) return
    out.push(
      <Box component="ul" key={`ul${out.length}`} sx={{ m: 0, pl: 2.5 }}>
        {bullets.map((b, i) => (
          <li key={i}>{inline(b)}</li>
        ))}
      </Box>,
    )
    bullets = []
  }
  for (const l of lines) {
    const b = /^\s*[-*•]\s+(.*)$/.exec(l)
    if (b) {
      bullets.push(b[1])
      continue
    }
    flush()
    if (l.trim()) out.push(<p key={`p${out.length}`} style={{ margin: 0 }}>{inline(l)}</p>)
  }
  flush()
  return (
    <Box dir="auto" sx={{ fontSize: 14, lineHeight: 1.55, color: tokens.ink, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {out}
    </Box>
  )
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))
}
