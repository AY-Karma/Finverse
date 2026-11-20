import { useRef, useState, type FormEvent } from 'react'
import { monitorRuleObservations, type MonitorRule, type RuleCondition } from '../monitor'
import type { Position } from '../types'
import { useStore } from '../useStore'
import type { MonitorController } from '../useMonitor'
import { numberFormatter } from '../formatters'
import { hasSupportedValuationCurrency } from '../valuation'

const CONDITIONS: Record<RuleCondition, string> = { price_above: 'Above', price_below: 'Below', daily_move: 'Daily move over' }
const ICONS: Record<RuleCondition, string> = { price_above: 'M4 17l6-6 4 4 6-10M14 5h6v6', price_below: 'M4 7l6 6 4-4 6 10M14 19h6v-6', daily_move: 'M3 12h4l3-7 4 14 3-7h4' }
const level = numberFormatter({ maximumFractionDigits: 2 })

function ruleLevel(rule: Pick<MonitorRule, 'condition' | 'threshold'>, currencySymbol = '₹'): string {
  return rule.condition === 'daily_move' ? `${level.format(rule.threshold)}%` : `${currencySymbol}${level.format(rule.threshold)}`
}

/** Watch rules for one holding: their live state and a quick way to add another. */
export function ResearchWatchRules({ controller, position }: { controller: MonitorController; position: Position }) {
  const { liveQuotes, workspaceReadOnly } = useStore()
  const [condition, setCondition] = useState<RuleCondition>('price_above')
  const [threshold, setThreshold] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [notice, setNotice] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)
  const rules = controller.rules.filter((rule) => rule.holdingId === position.id && !rule.unresolved)
  const observations = monitorRuleObservations(rules, controller.positions, liveQuotes, controller.now, controller.allowExternalData)
  const hide = controller.hideValues
  const supported = !position.identityIssue && hasSupportedValuationCurrency(position)
  const formOpen = adding && !hide

  function remove(rule: MonitorRule, row: HTMLElement | null) {
    const next = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLButtonElement>('.rd-watch-more') ?? addRef.current
    setMenuId(null)
    setNotice(true)
    controller.deleteRule(rule.id)
    requestAnimationFrame(() => next?.focus())
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = Number(threshold)
    if (!Number.isFinite(value) || value <= 0) { setError('Enter a positive level.'); return }
    setNotice(true)
    if (!controller.saveRule({ holdingId: position.id, condition, threshold: value })) { setError(''); return }
    setThreshold('')
    setError('')
    setAdding(false)
  }

  return <div className="rd-watch" aria-label="Watch rules">
    <div className="rd-watch-head">
      <h4>Watch rules</h4>
      {!formOpen && <button ref={addRef} type="button" className="rd-watch-action" disabled={hide || workspaceReadOnly || !supported} title={hide ? 'Turn off Hide values to add a watch rule.' : !supported ? 'Watch rules need a confirmed INR listing.' : undefined} onClick={() => setAdding(true)}>+ Add rule</button>}
    </div>
    {rules.length > 0 ? <ul className="rd-watch-list">
      {rules.map((rule) => {
        const observation = observations.get(rule.id)
        const live = rule.active && !hide && observation?.state === 'Active' ? observation : undefined
        const state = !rule.active ? 'Paused' : hide ? null : live?.matched ? 'Triggered' : live?.distance !== undefined ? `${live.distance.toFixed(1)}${rule.condition === 'daily_move' ? ' pts' : '%'} away`
          : observation?.state === 'Unavailable' ? 'Unavailable' : controller.allowExternalData ? 'Waiting for a price' : 'Market data paused'
        const now = live?.quote && (rule.condition === 'daily_move' ? `${live.quote.changePct! > 0 ? '+' : ''}${level.format(live.quote.changePct!)}% today` : `₹${level.format(live.quote.price)} now`)
        return <li key={rule.id} data-state={!rule.active ? 'paused' : live?.matched ? 'triggered' : 'watching'}>
          <svg className="rd-watch-icon" data-condition={rule.condition} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[rule.condition]} /></svg>
          <span>{rule.condition === 'daily_move' ? 'Daily move over' : `${position.type === 'mutual-fund' ? 'NAV' : 'Price'} ${CONDITIONS[rule.condition].toLowerCase()}`} <strong>{hide ? '••••' : ruleLevel(rule)}</strong></span>
          {now && <span className="rd-watch-now">{now}</span>}
          {state && <span className="rd-watch-state">{state}</span>}
          <div className="rd-watch-menu" data-open={menuId === rule.id} onKeyDown={(event) => { if (event.key === 'Escape') { setMenuId(null); event.currentTarget.querySelector<HTMLButtonElement>('.rd-watch-more')?.focus() } }}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuId(null) }}>
            <div className="rd-watch-menu-actions" id={`rd-watch-${rule.id}`} hidden={menuId !== rule.id}>
              <button type="button" className="rd-watch-action" disabled={workspaceReadOnly} onClick={(event) => { const more = event.currentTarget.closest('.rd-watch-menu')?.querySelector<HTMLButtonElement>('.rd-watch-more'); setNotice(true); controller.toggleRule(rule.id); setMenuId(null); requestAnimationFrame(() => more?.focus()) }}>{rule.active ? 'Pause' : 'Resume'}</button>
              <button type="button" className="rd-watch-action rd-watch-delete" disabled={workspaceReadOnly} onClick={(event) => remove(rule, event.currentTarget.closest('li'))}>Delete</button>
            </div>
            <button type="button" className="rd-watch-more" aria-label={`${menuId === rule.id ? 'Close' : 'Manage'} ${CONDITIONS[rule.condition].toLowerCase()} ${hide ? 'watch' : ruleLevel(rule)} rule`} aria-expanded={menuId === rule.id} aria-controls={`rd-watch-${rule.id}`} onClick={() => setMenuId(menuId === rule.id ? null : rule.id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{menuId === rule.id ? <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : <><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></>}</svg>
            </button>
          </div>
        </li>
      })}
    </ul> : !formOpen && <p className="rd-watch-empty">Get an Overview alert when this {position.type === 'mutual-fund' ? 'NAV' : 'price'} crosses a level.</p>}
    {formOpen && <form className="rd-watch-form" onSubmit={submit}>
      <select aria-label="Condition" value={condition} onChange={(event) => setCondition(event.target.value as RuleCondition)}>
        <option value="price_above">{position.type === 'mutual-fund' ? 'NAV' : 'Price'} above</option>
        <option value="price_below">{position.type === 'mutual-fund' ? 'NAV' : 'Price'} below</option>
        <option value="daily_move">Daily move over (%)</option>
      </select>
      <input aria-label="Level" inputMode="decimal" placeholder={condition === 'daily_move' ? '3' : '800'} value={threshold} onChange={(event) => setThreshold(event.target.value)} />
      <button type="submit" className="btn btn--primary btn--small">Save</button>
      <button type="button" className="rd-watch-action" onClick={() => { setAdding(false); setError('') }}>Cancel</button>
      {error && <p className="hint down" role="alert">{error}</p>}
    </form>}
    {notice && controller.statusMessage && <p className="rd-watch-status" role="status">{controller.statusMessage}</p>}
  </div>
}
