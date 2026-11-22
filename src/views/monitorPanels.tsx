import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { hasDuplicateMonitorRule, holdingIdentity, monitorRuleObservation, monitorRuleObservations, type MonitorRule, type RuleCondition, validReminderDate } from '../monitor'
import type { MonitorController } from '../useMonitor'
import { useStore } from '../useStore'
import { privateValue, visibleQuotes } from '../privacy'
import { dateFormatter, numberFormatter } from '../formatters'
import type { Position } from '../types'
import { signedPercent } from '../valuation'
import { watchSecurityKey } from '../watchSecurity'
import { fetchWatchQuote } from '../watchSecuritySearch'
import { ActionIcon } from './ActionIcon'
import { WatchSecurityPicker, type WatchTarget } from './WatchSecurityPicker'

type PanelProps = { controller: MonitorController }
export type RuleRequest = { holdingId: string; revision: number }
export type ReminderRequest = { holdingId?: string; title?: string; date?: string; revision: number }

const conditions: Record<RuleCondition, string> = {
  price_above: 'Price above',
  price_below: 'Price below',
  daily_move: 'Daily move exceeds',
}

const MAX_REMINDERS = 200
const MAX_RULES = 200

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function ReminderAction({ controller, onAdded, request }: PanelProps & { onAdded?: (date: string) => void; request?: ReminderRequest }) {
  const { workspaceReadOnly } = useStore()
  const dialog = useRef<HTMLDialogElement>(null)
  const [date, setDate] = useState(today)
  const [title, setTitle] = useState('')
  const [holdingId, setHoldingId] = useState('')
  const [error, setError] = useState('')
  const remaining = MAX_REMINDERS - controller.events.length

  useEffect(() => {
    if ((controller.hideValues || workspaceReadOnly) && dialog.current?.open) dialog.current.close()
  }, [controller.hideValues, workspaceReadOnly])

  useEffect(() => {
    if (!request || controller.hideValues || workspaceReadOnly || remaining <= 0) return
    if (request.holdingId && !controller.positions.some((position) => position.id === request.holdingId)) return
    setHoldingId(request.holdingId ?? '')
    setTitle(request.title?.slice(0, 160) ?? '')
    setDate(request.date && validReminderDate(request.date) && request.date >= today() ? request.date : today())
    setError('')
    if (!dialog.current?.open) dialog.current?.showModal()
  }, [request?.revision])

  function open() {
    setError('')
    if (date < today()) setDate(today())
    if (holdingId && !controller.positions.some((position) => position.id === holdingId)) setHoldingId('')
    dialog.current?.showModal()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      setError('Enter a reminder to continue.')
      return
    }
    if (holdingId && !controller.positions.some((position) => position.id === holdingId)) {
      setError('This holding is no longer in your portfolio. Choose another holding.')
      return
    }
    if (!validReminderDate(date) || date < today()) {
      setError('Choose a valid date today or later.')
      return
    }
    if (!controller.addReminder({ holdingId: holdingId || null, title: cleanTitle, date })) {
      setError(controller.statusMessage || 'Could not add this reminder. Check the holding, text and date.')
      return
    }
    onAdded?.(date)
    setTitle('')
    setError('')
    dialog.current?.close()
  }

  return <>
    <button className="mp-reminder-action" type="button" aria-label="Add reminder" disabled={controller.hideValues || workspaceReadOnly || remaining <= 0} title={controller.hideValues ? 'Turn off masking to add a reminder.' : undefined} onClick={open}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
      <span>Reminder</span>
    </button>
    <dialog className="mp-dialog" ref={dialog} aria-labelledby="mp-reminder-title">
      <form className="mp-form" onSubmit={submit}>
        <div className="mp-section-head">
          <h2 id="mp-reminder-title">Add a reminder</h2>
          <button className="mp-icon-button" type="button" aria-label="Close reminder form" onClick={() => dialog.current?.close()}>×</button>
        </div>
        <p className="mp-muted">Saved in this browser. No notification is sent. {remaining} reminder slots available.</p>
        <label className="mp-field">
          About
          <select value={holdingId} onChange={(event) => setHoldingId(event.target.value)}>
            <option value="">My portfolio</option>
            {controller.positions.map((position) => <option value={position.id} key={position.id}>{privateValue(position.name || position.ticker, controller.hideValues)}</option>)}
          </select>
        </label>
        <label className="mp-field">
          Reminder
          <input autoFocus required maxLength={160} value={controller.hideValues ? '' : title} onChange={(event) => setTitle(event.target.value)} placeholder="Review my watch levels" />
        </label>
        <label className="mp-field">
          Date
          <input type="date" required min={today()} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="mp-actions">
          <button type="submit" disabled={workspaceReadOnly || remaining <= 0}>Add reminder</button>
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
        </div>
      </form>
    </dialog>
  </>
}

export function RulesPanel({ controller, request }: PanelProps & { request?: RuleRequest }) {
  const { workspaceReadOnly } = useStore()
  const dialog = useRef<HTMLDialogElement>(null)
  const suggestion = useRef({ id: 0, edited: false })
  const [editing, setEditing] = useState<MonitorRule | null>(null)
  const [target, setTarget] = useState<WatchTarget | null>(null)
  const [condition, setCondition] = useState<RuleCondition>('price_above')
  const [threshold, setThreshold] = useState('')
  const [error, setError] = useState('')
  const quotes = useMemo(() => visibleQuotes(controller.allowExternalData, controller.quotes), [controller.allowExternalData, controller.quotes])
  const observations = useMemo(() => monitorRuleObservations(controller.rules, controller.positions, quotes, controller.now, controller.allowExternalData), [controller.rules, controller.positions, quotes, controller.now, controller.allowExternalData])
  const targetPosition = target?.kind === 'holding' ? controller.positions.find((position) => position.id === target.holdingId) : undefined
  const targetIsFund = target?.kind === 'security' ? target.security.kind === 'fund' : targetPosition?.type === 'mutual-fund'
  const ruleAvailable = (rule: MonitorRule) => !!rule.security || (!rule.unresolved && controller.positions.some((position) => position.id === rule.holdingId))
  const availableRules = controller.rules.filter(ruleAvailable)
  const unavailableRules = controller.rules.filter((rule) => !ruleAvailable(rule))
  const ruleName = (rule: MonitorRule, position?: Position) => rule.security ? rule.holding : privateValue(position?.name || position?.ticker || rule.holding, controller.hideValues)
  const remainingRules = Math.max(0, MAX_RULES - controller.rules.length)

  useEffect(() => {
    if ((controller.hideValues || workspaceReadOnly) && dialog.current?.open) dialog.current.close()
  }, [controller.hideValues, workspaceReadOnly])

  useEffect(() => {
    if (!request || controller.hideValues || workspaceReadOnly || remainingRules <= 0) return
    if (!controller.positions.some((position) => position.id === request.holdingId)) return
    open(null, request.holdingId)
  }, [request?.revision])

  const roundedPrice = (price: number) => String(Math.round(price * 100) / 100)

  /** Suggests a starting level from a fresh quote, unless the user has already typed one. */
  function suggestThreshold(next: WatchTarget | null, nextCondition: RuleCondition) {
    const current = suggestion.current = { id: suggestion.current.id + 1, edited: false }
    if (controller.hideValues || !next) return setThreshold('')
    if (nextCondition === 'daily_move') return setThreshold('3')
    if (next.kind === 'holding') {
      const position = controller.positions.find((item) => item.id === next.holdingId)
      const observation = position && monitorRuleObservation({ id: '', holding: '', holdingId: position.id, instrumentIdentity: holdingIdentity(position), active: true, condition: nextCondition, threshold: 1 }, controller.positions, quotes, controller.now, controller.allowExternalData)
      return setThreshold(observation?.quote ? roundedPrice(observation.quote.price) : '')
    }
    const known = quotes[watchSecurityKey(next.security)]
    if (known) return setThreshold(roundedPrice(known.price))
    setThreshold('')
    if (!controller.allowExternalData) return
    void fetchWatchQuote(next.security).then((quote) => {
      if (quote && suggestion.current === current && !current.edited) setThreshold(roundedPrice(quote.price))
    }).catch(() => {})
  }

  function conditionLabel(rule: MonitorRule) {
    if (controller.hideValues) return 'Watch level hidden'
    const position = controller.positions.find((item) => item.id === rule.holdingId)
    const amount = rule.condition === 'daily_move'
      ? `${rule.threshold}%`
      : numberFormatter({ style: 'currency', currency: position?.currency || 'INR', maximumFractionDigits: 2 }).format(rule.threshold)
    return `${conditions[rule.condition]} ${amount}`
  }

  function open(rule: MonitorRule | null = null, requestedId?: string) {
    const next: WatchTarget | null = rule?.security ? { kind: 'security', security: rule.security }
      : rule || requestedId ? { kind: 'holding', holdingId: rule?.holdingId ?? requestedId! } : null
    setEditing(rule)
    setTarget(next)
    setCondition(rule?.condition ?? 'price_above')
    if (rule) {
      suggestion.current = { id: suggestion.current.id + 1, edited: true }
      setThreshold(controller.hideValues ? '' : String(rule.threshold))
    } else suggestThreshold(next, 'price_above')
    setError('')
    if (!dialog.current?.open) dialog.current?.showModal()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(threshold)
    if (!target || (target.kind === 'holding' && !targetPosition)) {
      setError('Choose a security from the list.')
      return
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a threshold greater than zero.')
      return
    }
    const instrumentIdentity = target.kind === 'security' ? watchSecurityKey(target.security) : holdingIdentity(targetPosition!)
    if (hasDuplicateMonitorRule(controller.rules, { instrumentIdentity, condition, threshold: value }, editing?.id)) {
      setError('A watch rule with this security, condition and threshold already exists.')
      return
    }
    if (!controller.saveRule({ id: editing?.id, ...(target.kind === 'security' ? { security: target.security } : { holdingId: target.holdingId }), condition, threshold: value })) {
      setError(!editing && remainingRules === 0 ? 'Remove a watch rule before adding another.' : 'Could not save this rule. Check the security and threshold.')
      return
    }
    setError('')
    dialog.current?.close()
  }

  return <section className="mp-rules-panel">
    <div className="mp-section-head mp-feature-head">
      <div className="mp-feature-title mp-rule-heading">
        <span className="mp-heading-mark" aria-hidden="true"><ActionIcon name="activity" /></span>
        <h2>Watch rules</h2>
        {remainingRules <= 10 && <span className="mp-rule-capacity" aria-label={`${remainingRules} watch rules available`}>{remainingRules} left</span>}
      </div>
      <button type="button" disabled={controller.hideValues || workspaceReadOnly || controller.rules.length >= MAX_RULES} title={controller.hideValues ? 'Turn off masking to add a watch rule.' : undefined} onClick={() => open()}>+ New rule</button>
    </div>
    <div className="mp-rule-list">
      {availableRules.map((rule) => {
        const observation = observations.get(rule.id)!
        const triggered = !controller.hideValues && observation.state === 'Active' && observation.matched
        const badge = !rule.active ? 'Paused' : triggered ? 'Triggered' : !controller.hideValues && observation.state !== 'Active' ? observation.state : null
        const position = controller.positions.find((holding) => holding.id === rule.holdingId)
        const quote = !controller.hideValues && observation.state === 'Active' ? observation.quote : undefined
        const distance = observation.distance
        return <article className={`mp-rule-row${rule.active ? '' : ' mp-rule-paused'}`} key={rule.id}>
        <div className="mp-row-main">
          <div className="mp-rule-summary">
            <strong>{ruleName(rule, position)}</strong>
            {badge && <span className={`mp-kind mp-rule-state mp-rule-state--${badge.toLowerCase()}`}>{badge}</span>}
            <details className="mp-rule-menu" onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute('open')
            }} onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.currentTarget.removeAttribute('open')
              event.currentTarget.querySelector('summary')?.focus()
            }}>
              <summary aria-label={`Manage ${ruleName(rule)} ${controller.hideValues ? 'watch rule' : `${conditionLabel(rule)} rule`}`} title="Manage rule">
                <svg className="mp-rule-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
              </summary>
              <div className="mp-rule-menu-actions">
                <button type="button" disabled={controller.hideValues || workspaceReadOnly} title={controller.hideValues ? 'Turn off masking to edit watch rules.' : undefined} onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  open(rule)
                }}>Edit</button>
                <button type="button" disabled={workspaceReadOnly} onClick={(event) => {
                  event.currentTarget.closest('details')?.removeAttribute('open')
                  controller.toggleRule(rule.id)
                }}>{rule.active ? 'Pause' : 'Resume'}</button>
                <button type="button" disabled={workspaceReadOnly} aria-label={`Delete ${ruleName(rule)} ${controller.hideValues ? 'watch rule' : `${conditionLabel(rule)} rule`}`} onClick={() => controller.deleteRule(rule.id)}>Delete</button>
              </div>
            </details>
          </div>
          <p className="mp-rule-condition" data-condition={rule.condition}>
            {!controller.hideValues && <svg className="mp-rule-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={rule.condition === 'price_above' ? 'M4 17l6-6 4 4 6-10M14 5h6v6' : rule.condition === 'price_below' ? 'M4 7l6 6 4-4 6 10M14 19h6v-6' : 'M3 12h4l3-7 4 14 3-7h4'} />
            </svg>}
            <span>{conditionLabel(rule)}</span>
            {quote && <span className="mp-rule-observation" title={`${quote.source === 'nav' ? 'Published NAV' : quote.source === 'nse-close' ? 'NSE close' : 'Yahoo Finance'} · ${dateFormatter({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(quote.at)} IST`}>
              {rule.condition === 'daily_move' ? `${signedPercent(quote.changePct!)} today` : `${numberFormatter({ style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(quote.price)} now`}
              {!triggered && distance !== undefined && <span className="mp-rule-gap" data-near={distance < 2}>{distance === 0 ? 'at level' : `${distance.toFixed(1)}${rule.condition === 'daily_move' ? ' pts' : '%'} away`}</span>}
            </span>}
          </p>
          {!controller.hideValues && observation.state === 'Waiting' && !controller.allowExternalData && <p className="mp-rule-wait">Market data is paused.</p>}
        </div>
      </article>})}
      {unavailableRules.map((rule) => <article className="mp-rule-row mp-rule-paused" key={rule.id}>
        <div className="mp-row-main">
          <div className="mp-rule-summary"><strong>{privateValue(rule.holding || 'Unavailable holding', controller.hideValues)}</strong><span className="mp-kind mp-rule-state mp-rule-state--paused">Unavailable</span></div>
          <div className="mp-rule-controls"><p className="mp-rule-condition">{controller.hideValues ? 'Watch level hidden' : conditionLabel(rule)}</p>
            <button className="mp-text-button" type="button" disabled={workspaceReadOnly} aria-label={`Remove unavailable ${privateValue(rule.holding, controller.hideValues)} rule`} onClick={() => controller.deleteRule(rule.id)}>Remove</button>
          </div>
        </div>
      </article>)}
    </div>
    {!controller.rules.length && <p className="mp-empty">Add a watch rule to follow a price or daily move.</p>}
    <p className="mp-rules-note">Checked while Monitor is open.</p>
    <dialog className="mp-dialog" ref={dialog} aria-labelledby="mp-rule-title">
      <form className="mp-form" onSubmit={submit}>
        <div className="mp-section-head">
          <h2 id="mp-rule-title">{editing ? 'Edit watch rule' : 'Create a watch rule'}</h2>
          <button className="mp-icon-button" type="button" aria-label="Close rule form" onClick={() => dialog.current?.close()}>×</button>
        </div>
        <WatchSecurityPicker label="Security" positions={controller.positions} target={target} hideValues={controller.hideValues} onSelect={(next) => {
          setTarget(next)
          suggestThreshold(next, condition)
        }} />
        <label className="mp-field">
          Condition
          <select value={condition} onChange={(event) => {
            const next = event.target.value as RuleCondition
            setCondition(next)
            suggestThreshold(target, next)
          }}>
            {Object.entries(conditions).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label className="mp-field">
          {condition === 'daily_move' ? 'Move threshold (%)' : `${targetIsFund ? 'NAV' : 'Price'} threshold (₹)`}
          <input type="number" required min="0.01" step="0.01" value={controller.hideValues ? '' : threshold} onChange={(event) => { suggestion.current.edited = true; setThreshold(event.target.value) }} />
        </label>
        <p className="mp-muted">{condition === 'daily_move' ? 'Checks the size of either an upward or downward daily move.' : controller.allowExternalData ? 'Uses a fresh provider quote only to suggest a starting level. Enter a value if no quote is available.' : 'Market data is paused, so enter a price level manually.'} No background notification is sent.</p>
        {error && <p role="alert">{error}</p>}
        <div className="mp-actions">
          <button type="submit" disabled={workspaceReadOnly}>Save rule</button>
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
        </div>
      </form>
    </dialog>
  </section>
}
