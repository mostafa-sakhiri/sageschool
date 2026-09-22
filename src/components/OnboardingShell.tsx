import { Box, Stack, Typography } from '@mui/material'
import { LanguageToggle } from './AppShell'
import { tokens } from '#/theme/theme'

// Full-width layout without the sidebar: sign-in and the installation wizard.
export function OnboardingShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: tokens.paper }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', height: 64, px: { xs: 2, md: 4 }, borderBottom: `1px solid ${tokens.line}`, bgcolor: '#fff' }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flex: 1 }}>
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
            }}
          >
            S
          </Box>
          <Typography sx={{ fontWeight: 600 }}>SageSchool</Typography>
        </Stack>
        <LanguageToggle />
      </Stack>
      <Box sx={{ maxWidth: wide ? 1100 : 440, mx: 'auto', px: 2, py: { xs: 3, md: 6 } }}>{children}</Box>
    </Box>
  )
}
