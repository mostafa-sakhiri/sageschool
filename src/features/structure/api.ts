import { queryOptions } from '@tanstack/react-query'
import { supabase } from '#/lib/supabase/client'
import { must } from '#/lib/errors'
import type { Locale } from '#/i18n/i18n'

export const TEMPLATE = 'ma_public'

export type Node = {
  id: string
  parent_id: string | null
  kind: 'cycle' | 'level' | 'track' | 'option'
  code: string | null
  name: string
  name_ar: string | null
  position: number
  path: string[]
}

export const keys = {
  nodes: (s: string) => ['school', s, 'nodes'] as const,
  subjects: (s: string) => ['school', s, 'subjects'] as const,
  rooms: (s: string) => ['school', s, 'rooms'] as const,
  years: (s: string) => ['school', s, 'years'] as const,
  hours: (s: string, y: string) => ['school', s, 'hours', y] as const,
  resolved: (s: string, y: string) => ['school', s, 'resolved-hours', y] as const,
}

export const nodesQuery = (schoolId: string) =>
  queryOptions({
    queryKey: keys.nodes(schoolId),
    queryFn: async () =>
      must(
        await supabase
          .from('curriculum_nodes')
          .select('id, parent_id, kind, code, name, name_ar, position, path')
          .eq('school_id', schoolId),
      ) as Node[],
    select: sortTree,
  })

export const subjectsQuery = (schoolId: string) =>
  queryOptions({
    queryKey: keys.subjects(schoolId),
    queryFn: async () =>
      must(await supabase.from('subjects').select('id, name, code, room_id').eq('school_id', schoolId).order('name')),
  })

export const roomsQuery = (schoolId: string) =>
  queryOptions({
    queryKey: keys.rooms(schoolId),
    queryFn: async () =>
      must(await supabase.from('rooms').select('id, name, capacity').eq('school_id', schoolId).order('name')),
  })

// Years: shared with the session layer (same cache entry).
export { schoolYearsQuery as yearsQuery } from '#/lib/session'

export const hoursQuery = (schoolId: string, yearId: string) =>
  queryOptions({
    queryKey: keys.hours(schoolId, yearId),
    queryFn: async () =>
      must(
        await supabase
          .from('node_subject_hours')
          .select('id, node_id, subject_id, weekly_minutes, status')
          .eq('academic_year_id', yearId),
      ),
  })

export const resolvedHoursQuery = (schoolId: string, yearId: string) =>
  queryOptions({
    queryKey: keys.resolved(schoolId, yearId),
    queryFn: async () =>
      must(
        await supabase
          .from('resolved_node_subject_hours')
          .select('node_id, defined_on_node_id, subject_id, weekly_minutes')
          .eq('academic_year_id', yearId),
      ),
  })

// Depth-first order following `position`, so lists read like the tree.
export function sortTree(nodes: Node[]): Node[] {
  const byParent = new Map<string | null, Node[]>()
  for (const n of nodes) {
    const k = n.parent_id
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(n)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.position - b.position)
  const out: Node[] = []
  const walk = (p: string | null) => {
    for (const n of byParent.get(p) ?? []) {
      out.push(n)
      walk(n.id)
    }
  }
  walk(null)
  return out
}

export function nodeName(n: Pick<Node, 'name' | 'name_ar'>, locale: Locale) {
  return locale === 'ar' && n.name_ar ? n.name_ar : n.name
}

// Nodes a class can hang on: the lowest node of each branch.
export function leafNodes(nodes: Node[]) {
  const parents = new Set(nodes.map((n) => n.parent_id).filter(Boolean))
  return nodes.filter((n) => !parents.has(n.id) && n.kind !== 'cycle')
}

// "Lycée › 2ème Bac › Sciences expérimentales" (cycle omitted when depth > 2)
export function nodeLabel(n: Node, all: Node[], locale: Locale) {
  const byId = new Map(all.map((x) => [x.id, x]))
  const chain = n.path.map((id) => byId.get(id)).filter(Boolean) as Node[]
  const shown = chain.length > 2 ? chain.slice(1) : chain.slice(chain.length > 1 ? 1 : 0)
  return shown.map((x) => nodeName(x, locale)).join(' › ')
}

// Durations with localized units: "1 h 30" / "1 س 30 د".
export function formatMinutes(m: number, locale: Locale = 'fr') {
  const h = Math.floor(m / 60)
  const r = m % 60
  const [H, M] = locale === 'ar' ? ['س', 'د'] : ['h', 'min']
  if (!h) return `${r} ${M}`
  if (!r) return `${h} ${H}`
  return locale === 'ar' ? `${h} ${H} ${r} ${M}` : `${h} ${H} ${String(r).padStart(2, '0')}`
}
