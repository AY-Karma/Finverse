import { useId, useState } from 'react'

export function MovementCalculationHelp({ session = false }: { session?: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  return <button type="button" className="risk-help movement-help" aria-label="How market moves are calculated" aria-expanded={open} aria-describedby={id} data-tooltip-dismissed={dismissed || undefined}
    onFocus={() => setDismissed(false)} onMouseEnter={() => setDismissed(false)}
    onClick={() => { setOpen(!open); setDismissed(open) }} onBlur={() => { setOpen(false); setDismissed(false) }} onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); setDismissed(true) } }}>
    i
    <span id={id} role="tooltip" className="risk-help-popover">
      <strong>Current quantity × price change</strong>
      <span>{session ? 'Includes stock and ETF moves, plus NAV changes published for this session. Holdings without a reported change are excluded.' : 'Reprices today’s holdings. Past trades, payments and quantity changes are excluded.'}</span>
      {!session && <span>Opening prices use the last close before the period, within seven days. End prices use a provider quote or close from the past seven days.</span>}
    </span>
  </button>
}
