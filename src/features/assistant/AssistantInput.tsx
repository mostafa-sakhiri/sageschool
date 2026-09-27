import { useState } from 'react'
import { Box, Chip, IconButton, InputBase, Paper, Stack } from '@mui/material'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined'
import { useI18n } from '#/i18n/i18n'
import { tokens } from '#/theme/theme'
import { useAssistantUi } from './shell'

// The dashboard's "Que voulez-vous faire ?": typing an intent opens the
// assistant's panel with it, where the action's card appears.
export function AssistantInput() {
  const ui = useAssistantUi()
  const { t } = useI18n()
  const [text, setText] = useState('')
  if (!ui) return null
  const send = (s = text) => {
    if (!s.trim()) return
    ui.ask(s)
    setText('')
  }
  return (
    <Box sx={{ mb: 3 }}>
      <Paper
        component="form"
        variant="outlined"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 1.75,
          pr: 0.75,
          py: 0.75,
          borderRadius: 3,
          bgcolor: tokens.surface,
          transition: 'border-color 120ms, box-shadow 120ms',
          '&:focus-within': { borderColor: tokens.accent, boxShadow: `0 0 0 3px ${tokens.accentSoft}` },
        }}
      >
        <AutoAwesomeOutlined sx={{ fontSize: 20, color: tokens.accent }} />
        <InputBase
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('assistant.dashPlaceholder')}
          fullWidth
          inputProps={{ dir: 'auto', 'aria-label': t('assistant.dashPlaceholder') }}
          sx={{ fontSize: 15 }}
        />
        <IconButton
          type="submit"
          size="small"
          disabled={!text.trim() || ui.busy}
          aria-label={t('assistant.send')}
          sx={{ bgcolor: tokens.accent, color: '#fff', '&:hover': { bgcolor: tokens.accentHover }, '&.Mui-disabled': { bgcolor: tokens.fill } }}
        >
          <ArrowUpwardOutlined fontSize="small" />
        </IconButton>
      </Paper>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
        {['assistant.ex.enroll', 'assistant.ex.visit', 'assistant.ex.announce', 'assistant.ex.find'].map((k) => (
          <Chip key={k} size="small" variant="outlined" label={t(k)} onClick={() => send(t(k))} disabled={ui.busy} />
        ))}
      </Stack>
    </Box>
  )
}
