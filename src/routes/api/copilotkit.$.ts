import { createFileRoute } from '@tanstack/react-router'

// AG-UI endpoint of the assistant (CopilotKit runtime). Loaded lazily so the
// runtime never reaches the client bundle.
const handle = async ({ request }: { request: Request }) => {
  const { handleAssistant } = await import('#/features/assistant/server')
  return handleAssistant(request)
}

export const Route = createFileRoute('/api/copilotkit/$')({
  server: { handlers: { GET: handle, POST: handle } },
})
