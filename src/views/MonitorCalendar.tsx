import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'

type CalendarTab = 'ipos' | 'economy' | 'company'

const STORAGE_KEY = 'finverse:monitor-calendar-tab'
/** Links into Monitor (for example from Overview notifications) choose a tab with these anchors. */
const CALENDAR_ANCHORS: Record<string, CalendarTab> = { 'monitor-ipos': 'ipos', 'monitor-economy': 'economy', 'monitor-company': 'company' }
export const NAVIGATE_ANCHOR_EVENT = 'finverse:navigate-anchor'
const LABELS: Record<CalendarTab, string> = { ipos: 'IPOs', economy: 'Economic calendar', company: 'Company updates' }
// Phones show short labels so the three tabs and the tab action fit on one row.
const SHORT_LABELS: Record<CalendarTab, string> = { ipos: 'IPOs', economy: 'Economy', company: 'Company' }

function savedTab(): CalendarTab | null {
  const anchored = CALENDAR_ANCHORS[window.location.hash.slice(1)]
  if (anchored) return anchored
  try { const saved = sessionStorage.getItem(STORAGE_KEY); return saved && saved in LABELS ? saved as CalendarTab : null } catch { return null }
}

function revealCalendar() {
  window.requestAnimationFrame(() => document.getElementById('monitor-calendar')?.scrollIntoView?.({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }))
}

/** The selected calendar tab, remembered for the session and set by in-app links to a Monitor anchor. */
export function useCalendarTab(hasPortfolio: boolean): [CalendarTab, (tab: CalendarTab) => void] {
  const [tab, setTab] = useState<CalendarTab>(() => savedTab() ?? 'ipos')
  const select = (next: CalendarTab) => {
    setTab(next)
    try { sessionStorage.setItem(STORAGE_KEY, next) } catch { /* remembering the tab is optional */ }
  }
  useEffect(() => {
    if (CALENDAR_ANCHORS[window.location.hash.slice(1)]) revealCalendar()
    const onAnchor = (event: Event) => {
      const next = CALENDAR_ANCHORS[(event as CustomEvent<string>).detail]
      if (!next) return
      select(next)
      revealCalendar()
    }
    window.addEventListener(NAVIGATE_ANCHOR_EVENT, onAnchor)
    return () => window.removeEventListener(NAVIGATE_ANCHOR_EVENT, onAnchor)
  }, [])
  return [tab === 'company' && !hasPortfolio ? 'ipos' : tab, select]
}

/** One card for IPOs, the economic calendar and company updates; only the selected tab loads its data. */
export function MonitorCalendar({ tab, onTab, hasPortfolio, action, children }: { tab: CalendarTab; onTab: (tab: CalendarTab) => void; hasPortfolio: boolean; action?: ReactNode; children: ReactNode }) {
  const id = useId()
  const tabs: CalendarTab[] = hasPortfolio ? ['ipos', 'economy', 'company'] : ['ipos', 'economy']
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.indexOf(tab)
    const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
      : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null
    if (!next) return
    event.preventDefault()
    onTab(next)
    document.getElementById(`${id}-${next}`)?.focus()
  }
  return <section className="mp-panel mc-panel" id="monitor-calendar" aria-label="Market calendar">
    <div className="mc-head">
      <div className="mc-tabs" role="tablist" aria-label="Market calendar">
        {tabs.map((item) => <button type="button" role="tab" key={item} id={`${id}-${item}`} aria-selected={tab === item} aria-controls={`${id}-panel`} tabIndex={tab === item ? 0 : -1} onClick={() => onTab(item)} onKeyDown={move} aria-label={LABELS[item]}><span className="mc-label">{LABELS[item]}</span><span className="mc-label-short" aria-hidden="true">{SHORT_LABELS[item]}</span></button>)}
      </div>
      {action && <div className="mc-action">{action}</div>}
    </div>
    <div className="mc-body" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>{children}</div>
  </section>
}
