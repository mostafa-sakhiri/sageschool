// Matching names typed by a person (or the model) against real rows: the
// model gives "Mme Idrissi", "petite section", "eveil"; the code decides which
// row that is, or says it is ambiguous / unknown. Never a guess.

export const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

// Civilities and filler words that don't identify anyone
const NOISE = new Set(['m', 'mr', 'mme', 'mlle', 'madame', 'monsieur', 'mademoiselle', 'prof', 'professeur', 'professeure', 'maitresse', 'maitre', 'la', 'le', 'les', 'de', 'du', 'des', 'l', 'd'])
const tokens = (s: string) => norm(s).split(' ').filter((w) => w && !NOISE.has(w))

export type Match<T> = { item: T | null; candidates: T[] }

export function matchOne<T>(items: readonly T[], label: (x: T) => string | (string | null | undefined)[], query: string | null | undefined): Match<T> {
  if (!query || !norm(query)) return { item: null, candidates: [] }
  const q = norm(query)
  const qt = tokens(query)
  const labels = (x: T) => {
    const l = label(x)
    return (Array.isArray(l) ? l : [l]).filter((s): s is string => !!s)
  }
  const exact = items.filter((x) => labels(x).some((l) => norm(l) === q))
  if (exact.length) return { item: exact.length === 1 ? exact[0] : null, candidates: exact }
  // Every meaningful word of the query appears in the label ("idrissi" ⊂ "Salma Idrissi")
  const scored = items
    .map((x) => {
      let best = 0
      for (const l of labels(x)) {
        const lt = tokens(l)
        if (!qt.length) continue
        const hits = qt.filter((w) => lt.some((v) => v === w || (w.length >= 3 && v.startsWith(w)))).length
        if (hits === qt.length) best = Math.max(best, hits / Math.max(lt.length, 1))
      }
      return { x, best }
    })
    .filter((s) => s.best > 0)
    .sort((a, b) => b.best - a.best)
  if (!scored.length) return { item: null, candidates: [] }
  const top = scored.filter((s) => s.best === scored[0].best).map((s) => s.x)
  return { item: top.length === 1 ? top[0] : null, candidates: scored.map((s) => s.x) }
}

// "HH:MM" or "H:MM" or "9h" / "9h30" / "14" → "HH:MM"; null when unreadable
export function normTime(s: string | null | undefined): string | null {
  if (!s) return null
  const m = /^\s*(\d{1,2})\s*(?:[:hH.]\s*(\d{2})?)?\s*$/.exec(s)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// "YYYY-MM-DD" only; anything else is dropped rather than misread
export function normDate(s: string | null | undefined): string | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return null
  const d = new Date(`${s.trim()}T12:00:00`)
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3]) ? null : s.trim()
}
