/** Keep the existing chart stretched during layout motion, then redraw once it settles. */
export function observeSettledResize(elements: readonly Element[], measure: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(measure, 160)
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  if (observer) elements.forEach((element) => observer.observe(element))
  else window.addEventListener('resize', schedule)
  return () => {
    clearTimeout(timer)
    observer?.disconnect()
    window.removeEventListener('resize', schedule)
  }
}
