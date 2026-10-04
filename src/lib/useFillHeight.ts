import { useCallback, useEffect, useState } from 'react'

// Height that takes an element down to the bottom of the window (less
// `bottom` px), measured from where it sits on the page: a two-pane screen
// uses the whole page and scrolls inside its panes.
export function useFillHeight(bottom = 32) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  const measure = useCallback(() => {
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    setHeight(Math.max(0, window.innerHeight - top - bottom))
  }, [el, bottom])
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    // what sits above may change size (a banner appears)
    const ro = el?.parentElement ? new ResizeObserver(measure) : null
    if (ro && el?.parentElement) ro.observe(el.parentElement)
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [measure, el])
  return { ref: setEl, height }
}
