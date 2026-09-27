// Vertical time axis of a week grid. Proportional to duration, except that a
// short item (a 15-minute préscolaire activity) never gets fewer pixels than
// it needs to show its time and title: the stretch where it sits grows, and
// only that stretch. The axis is piecewise linear between every start/end
// that appears in the week, so items in other columns stay aligned in time.

type Span = { start: number; end: number; min: number } // minutes, minimum px

export type TimeAxis = {
  y: (minute: number) => number
  minuteAt: (y: number) => number
  height: number
  cuts: number[] // every start/end of the week, in order
}

export function timeAxis(from: number, to: number, spans: Span[], scale: number): TimeAxis {
  const cuts = [...new Set([from, to, ...spans.flatMap((s) => [s.start, s.end])])].filter((m) => m >= from && m <= to).sort((a, b) => a - b)
  const px = cuts.slice(1).map((m, i) => (m - cuts[i]) * scale)
  const seg = (m: number) => Math.max(0, cuts.findIndex((c, i) => i > 0 && m <= c) - 1)

  // Stretch the segments under each short span, proportionally, until it fits
  for (const s of [...spans].sort((a, b) => a.end - a.start - (b.end - b.start))) {
    const first = cuts.indexOf(s.start)
    const last = cuts.indexOf(s.end)
    if (first < 0 || last <= first) continue
    const have = px.slice(first, last).reduce((a, b) => a + b, 0)
    if (have >= s.min) continue
    for (let i = first; i < last; i++) px[i] = px[i] * (s.min / have)
  }

  const tops = [0]
  for (const p of px) tops.push(tops[tops.length - 1] + p)
  const y = (m: number) => {
    if (m <= from) return (m - from) * scale
    if (m >= to) return tops[tops.length - 1] + (m - to) * scale
    const i = seg(m)
    return tops[i] + ((m - cuts[i]) / (cuts[i + 1] - cuts[i])) * px[i]
  }
  const minuteAt = (yy: number) => {
    const i = Math.max(0, tops.findIndex((t, k) => k > 0 && yy <= t) - 1)
    if (i >= px.length || px[i] === 0) return to
    return cuts[i] + ((yy - tops[i]) / px[i]) * (cuts[i + 1] - cuts[i])
  }
  return { y, minuteAt, height: tops[tops.length - 1], cuts }
}
