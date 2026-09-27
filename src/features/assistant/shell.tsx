import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useSchool } from '#/lib/session'
import type { TimetableAssistantInput } from '#/features/timetable/assistant'

// The light half of the assistant, always loaded: whether the panel is open,
// and what pages hand to it. CopilotKit and the chat itself live in ./root,
// loaded lazily and only for the office, so other roles never download them
// and pages never import them.

export const PANEL_WIDTH = 420
export const PANEL_WIDE = 680
export const PANEL_MIN = 360
const LS_WIDTH = 'sage.assistant.width'
const LS_CLOSED = 'sage.assistant.closed'

// Never so wide that the page next to it becomes unusable
export const clampWidth = (w: number) =>
  Math.round(Math.max(PANEL_MIN, Math.min(w, typeof window === 'undefined' ? 900 : Math.max(PANEL_MIN, window.innerWidth - 480))))

function readWidth() {
  try {
    const w = Number(localStorage.getItem(LS_WIDTH))
    return w ? clampWidth(w) : PANEL_WIDTH
  } catch {
    return PANEL_WIDTH
  }
}

export type AssistantUi = {
  open: boolean
  setOpen: (open: boolean) => void
  // Panel width on desktop (px), dragged or toggled wide, remembered per browser
  width: number
  setWidth: (w: number) => void
  // The panel is part of the page layout: AppShell gives it a column with
  // `dock` (a ref callback). The chat renders into `panelNode`, one DOM node
  // moved from page to page, so a card being filled survives navigation.
  dock: (column: HTMLElement | null) => (() => void) | undefined
  docked: boolean
  panelNode: HTMLElement | null
  // Opens the panel and sends `text` as the user's message (queued until the
  // chat has loaded)
  ask: (text: string) => void
  busy: boolean
  error: string | null
  stop: () => void
  clear: () => void
}

// What the loaded chat provides to the shell
export type Bridge = Pick<AssistantUi, 'busy' | 'error' | 'stop' | 'clear'> & { send: (text: string) => void }

const AssistantUiContext = createContext<AssistantUi | null>(null)

// null outside the office (no assistant)
export const useAssistantUi = () => useContext(AssistantUiContext)

// ----------------------------------------------------- page → assistant data
// A page publishes plain data; the chat side turns it into tools and context.
export type Slots = { timetable?: TimetableAssistantInput }
type SlotStore = { get: () => Slots; set: <K extends keyof Slots>(k: K, v: Slots[K] | undefined) => void; subscribe: (l: () => void) => () => void }

function createSlotStore(): SlotStore {
  let slots: Slots = {}
  const listeners = new Set<() => void>()
  return {
    get: () => slots,
    set: (k, v) => {
      slots = { ...slots, [k]: v }
      for (const l of listeners) l()
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}
const SlotContext = createContext<SlotStore | null>(null)

export function useAssistantSlot<K extends keyof Slots>(key: K, value: Slots[K] | undefined) {
  const store = useContext(SlotContext)
  useEffect(() => {
    store?.set(key, value)
  })
  useEffect(() => () => store?.set(key, undefined), [store, key])
}

export function useSlots() {
  const store = useContext(SlotContext)!
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

// ---------------------------------------------------------------- provider
const AssistantRoot = lazy(() => import('./root'))

export function AssistantProvider({ children }: { children: ReactNode }) {
  const ctx = useSchool()
  if (!ctx.isOffice) return <>{children}</>
  return <Shell>{children}</Shell>
}

function Shell({ children }: { children: ReactNode }) {
  // Open by default on desktop, on every page (a column next to the page);
  // closing it is remembered per browser. Phones: closed (it would cover
  // the page).
  const [open, setOpenState] = useState(false)
  useEffect(() => {
    let closed = false
    try {
      closed = localStorage.getItem(LS_CLOSED) === '1'
    } catch {
      /* private mode: default applies */
    }
    if (!closed && window.matchMedia('(min-width: 900px)').matches) setOpenState(true)
  }, [])
  const setOpen = useCallback((v: boolean) => {
    setOpenState(v)
    try {
      if (v) localStorage.removeItem(LS_CLOSED)
      else localStorage.setItem(LS_CLOSED, '1')
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  }, [])
  const [width, setWidthState] = useState(PANEL_WIDTH)
  useEffect(() => setWidthState(readWidth()), [])
  const setWidth = useCallback((w: number) => {
    const v = clampWidth(w)
    setWidthState(v)
    try {
      localStorage.setItem(LS_WIDTH, String(v))
    } catch {
      /* private mode: the width just isn't remembered */
    }
  }, [])
  const [panelNode] = useState(() => (typeof document === 'undefined' ? null : document.createElement('div')))
  const docks = useRef(0)
  const [docked, setDocked] = useState(false)
  const dock = useCallback(
    (column: HTMLElement | null) => {
      if (!column || !panelNode) return
      panelNode.style.height = '100%'
      column.appendChild(panelNode)
      docks.current++
      setDocked(true)
      return () => {
        docks.current--
        if (panelNode.parentElement === column) column.removeChild(panelNode)
        // Navigating: the next page docks it again in the same commit
        if (docks.current === 0) setDocked(false)
      }
    },
    [panelNode],
  )
  const [bridge, setBridge] = useState<Bridge | null>(null)
  const queue = useRef<string[]>([])
  const store = useMemo(createSlotStore, [])

  useEffect(() => {
    if (!bridge) return
    for (const text of queue.current.splice(0)) bridge.send(text)
  }, [bridge])

  const ask = useCallback(
    (text: string) => {
      setOpen(true)
      if (!text.trim()) return
      if (bridge) bridge.send(text)
      else queue.current.push(text)
    },
    [bridge],
  )
  const value = useMemo<AssistantUi>(
    () => ({
      open,
      setOpen,
      width,
      setWidth,
      dock,
      docked,
      panelNode,
      ask,
      busy: bridge?.busy ?? queue.current.length > 0,
      error: bridge?.error ?? null,
      stop: bridge?.stop ?? (() => {}),
      clear: bridge?.clear ?? (() => {}),
    }),
    [open, width, setWidth, dock, docked, panelNode, ask, bridge],
  )
  return (
    <AssistantUiContext.Provider value={value}>
      <SlotContext.Provider value={store}>
        {children}
        <Suspense fallback={null}>
          <AssistantRoot onBridge={setBridge} />
        </Suspense>
      </SlotContext.Provider>
    </AssistantUiContext.Provider>
  )
}
