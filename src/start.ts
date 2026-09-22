import { createStart } from '@tanstack/react-start'

// The app renders client-side behind an SSR shell (DECISIONS.md D-006): data is
// read through the RLS-scoped browser client, auth is checked server-side with
// getClaims() in a server function.
export const startInstance = createStart(() => ({ defaultSsr: false }))
