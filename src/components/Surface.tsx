import { createContext, useContext, type ReactNode } from 'react'
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, Paper, type DialogProps } from '@mui/material'
import { tokens } from '#/theme/theme'

// The same form either as a dialog (pages) or as an inline card (assistant
// chat). Forms use these instead of MUI's Dialog* so their logic is shared;
// a <SurfaceContext value="card"> around them switches the rendering.
export type SurfaceKind = 'dialog' | 'card'
export const SurfaceContext = createContext<SurfaceKind>('dialog')
export const useSurface = () => useContext(SurfaceContext)

export function SurfaceDialog({ children, ...props }: DialogProps) {
  if (useSurface() === 'dialog') return <Dialog {...props}>{children}</Dialog>
  if (!props.open) return null
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', bgcolor: tokens.surface }}>
      {children}
    </Paper>
  )
}

export function SurfaceTitle({ children }: { children: ReactNode }) {
  if (useSurface() === 'dialog') return <DialogTitle>{children}</DialogTitle>
  return <Box sx={{ px: 2, pt: 1.75, pb: 0.5, fontWeight: 600, fontSize: 15 }}>{children}</Box>
}

export function SurfaceContent({ children }: { children: ReactNode }) {
  if (useSurface() === 'dialog') return <DialogContent>{children}</DialogContent>
  return <Box sx={{ px: 2, py: 1 }}>{children}</Box>
}

export function SurfaceActions({ children }: { children: ReactNode }) {
  if (useSurface() === 'dialog') return <DialogActions>{children}</DialogActions>
  return (
    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap', px: 2, pb: 1.5, pt: 0.5 }}>{children}</Box>
  )
}
