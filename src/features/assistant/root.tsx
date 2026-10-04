import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { CopilotKitProvider, useAgent, useAgentContext, useCopilotKit, UseAgentUpdate } from '@copilotkit/react-core/v2'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { todayIso } from '#/lib/format'
import { classesQuery } from '#/features/classes/api'
import { nodeLabel, nodesQuery } from '#/features/structure/api'
import { TimetableAssistant } from '#/features/timetable/assistant'
import { AssistantPanel } from './AssistantPanel'
import { GlobalTools } from './tools'
import { useSlots, type Bridge } from './shell'

// The heavy half of the assistant (spec: docs/superpowers/specs/2026-09-26-assistant-design.md),
// loaded lazily by the shell: the CopilotKit provider, the agent run, the
// context every request carries, the global actions, the page tools and the
// chat panel.
export default function AssistantRoot({ onBridge }: { onBridge: (b: Bridge) => void }) {
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  // Stable: AgentBridge's callbacks depend on it, and a new callback means a
  // new bridge, a shell re-render, a new AssistantRoot render… (render loop)
  const clearRuntimeError = useCallback(() => setRuntimeError(null), [])
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" showDevConsole={false} enableInspector={false} onError={({ error }) => setRuntimeError(error.message || 'error')}>
      <AgentBridge onBridge={onBridge} runtimeError={runtimeError} clearRuntimeError={clearRuntimeError} />
      <SchoolContextForAgent />
      <GlobalTools />
      <PageTools />
      <AssistantPanel />
    </CopilotKitProvider>
  )
}

function AgentBridge({ onBridge, runtimeError, clearRuntimeError }: { onBridge: (b: Bridge) => void; runtimeError: string | null; clearRuntimeError: () => void }) {
  const { agent } = useAgent({ updates: [UseAgentUpdate.OnRunStatusChanged] })
  const { copilotkit } = useCopilotKit()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      setError(null)
      clearRuntimeError()
      agent.addMessage({ id: crypto.randomUUID(), role: 'user', content })
      try {
        // Resolves once the agent is done, cards answered included
        await copilotkit.runAgent({ agent })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [agent, copilotkit, clearRuntimeError],
  )
  const stop = useCallback(() => copilotkit.stopAgent({ agent }), [agent, copilotkit])
  const clear = useCallback(() => {
    if (busyRef.current) copilotkit.stopAgent({ agent })
    agent.setMessages([])
    setError(null)
    clearRuntimeError()
  }, [agent, copilotkit, clearRuntimeError])

  useEffect(() => {
    onBridge({ send: (t) => void send(t), busy, error: error ?? runtimeError, stop, clear })
  }, [onBridge, send, busy, error, runtimeError, stop, clear])
  return null
}

// Tools and context of the page on screen, from the data it published
function PageTools() {
  const slots = useSlots()
  return slots.timetable ? <TimetableAssistant {...slots.timetable} /> : null
}

// What every request knows: who asks, where, when, and the school's names
// (classes, levels) so the model uses real ones.
function SchoolContextForAgent() {
  const ctx = useSchool()
  const { locale, t } = useI18n()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> })
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const today = todayIso()
  const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(new Date(`${today}T12:00:00`))
  useAgentContext({
    description: "L'utilisateur, l'école et la page ouverte",
    value: {
      today: `${today} (${weekday})`,
      language: locale === 'ar' ? 'arabe' : 'français',
      user: ctx.user.full_name,
      role: t(`role.${ctx.role}`),
      canManageTeam: ctx.isAdmin,
      canSeeFees: ctx.canFees,
      // What the role may do: only offer that
      permissions: ctx.permissions,
      school: ctx.school.name,
      schoolYear: ctx.year?.name ?? null,
      page: pathname,
      pageMode: typeof search.mode === 'string' ? search.mode : null,
      classes: (classes.data ?? []).map((c) => c.name),
      cycles: (nodes.data ?? []).filter((n) => n.kind === 'cycle').map((n) => n.name),
      levels: (nodes.data ?? []).filter((n) => n.kind === 'level').map((n) => nodeLabel(n, nodes.data ?? [], 'fr')),
      isAdmin: ctx.isAdmin,
    },
  })
  return null
}
