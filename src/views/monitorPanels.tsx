import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { hasDuplicateMonitorRule, holdingIdentity, monitorRuleObservation, monitorRuleObservations, type MonitorRule, type RuleCondition, validReminderDate } from '../monitor'
import type { MonitorController } from '../useMonitor'
import { useStore } from '../useStore'
import { privateValue, visibleQuotes } from '../privacy'
import { dateFormatter, numberFormatter } from '../formatters'

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
  const { liveQuotes, workspaceReadOnly } = useStore()
  const dialog = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState<MonitorRule | null>(null)
  const [holdingId, setHoldingId] = useState('')
  const [condition, setCondition] = useState<RuleCondition>('price_above')
  const [threshold, setThreshold] = useState('')
  const [error, setError] = useState('')
  const quotes = useMemo(() => visibleQuotes(controller.allowExternalData, liveQuotes), [controller.allowExternalData, liveQuotes])
  const observations = useMemo(() => monitorRuleObservations(controller.rules, controller.positions, quotes, controller.now, controller.allowExternalData), [controller.rules, controller.positions, quotes, controller.now, controller.allowExternalData])
  const selected = controller.positions.find((position) => position.id === holdingId)
  const availableRules = controller.rules.filter((rule) => !rule.unresolved && controller.positions.some((position) => position.id === rule.holdingId))
  const unavailableRules = controller.rules.filter((rule) => rule.unresolved || !controller.positions.some((position) => position.id === rule.holdingId))
  const remainingRules = Math.max(0, MAX_RULES - controller.rules.length)

  useEffect(() => {
    if ((controller.hideValues || workspaceReadOnly) && dialog.current?.open) dialog.current.close()
  }, [controller.hideValues, workspaceReadOnly])

  useEffect(() => {
    if (!request || controller.hideValues || workspaceReadOnly || remainingRules <= 0) return
    if (!controller.positions.some((position) => position.id === request.holdingId)) return
    open(null, request.holdingId)
  }, [request?.revision])

  function defaultThreshold(id: string, nextCondition: RuleCondition) {
    if (controller.hideValues) return ''
    if (nextCondition === 'daily_move') return '3'
    const position = controller.positions.find((item) => item.id === id)
    if (!position) return ''
    const observation = monitorRuleObservation({ id: '', holding: '', holdingId: id, instrumentIdentity: holdingIdentity(position), active: true, condition: nextCondition, threshold: 1 }, controller.positions, quotes, controller.now, controller.allowExternalData)
    return observation.quote ? String(Math.round(observation.quote.price * 100) / 100) : ''
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
    const id = rule?.holdingId ?? requestedId ?? controller.positions[0]?.id ?? ''
    setEditing(rule)
    setHoldingId(id)
    setCondition(rule?.condition ?? 'price_above')
    setThreshold(rule ? (controller.hideValues ? '' : String(rule.threshold)) : defaultThreshold(id, 'price_above'))
    setError('')
    if (!dialog.current?.open) dialog.current?.showModal()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(threshold)
    const position = controller.positions.find((item) => item.id === holdingId)
    if (!position) {
      setError('Choose a holding currently in your portfolio.')
      return
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter a threshold greater than zero.')
      return
    }
    if (hasDuplicateMonitorRule(controller.rules, { instrumentIdentity: holdingIdentity(position), condition, threshold: value }, editing?.id)) {
      setError('A watch rule with this holding, condition and threshold already exists.')
      return
    }
    if (!controller.saveRule({ id: editing?.id, holdingId, condition, threshold: value })) {
      setError(!editing && remainingRules === 0 ? 'Remove a watch rule before adding another.' : 'Could not save this rule. Check the holding and threshold.')
      return
    }
    setError('')
    dialog.current?.close()
  }

  return <section className="mp-rules-panel">
    <div className="mp-section-head">
      <div className="mp-rule-heading">
        <h2>Your watch rules</h2>
        {remainingRules <= 10 && <span className="mp-rule-capacity" aria-label={`${remainingRules} watch rules available`}>{remainingRules} left</span>}
      </div>
      <button type="button" disabled={controller.hideValues || workspaceReadOnly || !controller.positions.length || controller.rules.length >= MAX_RULES} title={controller.hideValues ? 'Turn off masking to add a watch rule.' : undefined} onClick={() => open()}>+ New rule</button>
    </div>
    <div className="mp-rule-list">
      {availableRules.map((rule) => {
        const observation = observations.get(rule.id)!
        const state = controller.hideValues ? rule.active ? 'Active' : 'Paused' : observation.state
        const position = controller.positions.find((holding) => holding.id === rule.holdingId)
        return <article className={`mp-rule-row${rule.active ? '' : ' mp-rule-paused'}`} key={rule.id}>
        <div className="mp-row-main">
          <div className="mp-rule-summary">
            <strong>{privateValue(position?.name || position?.ticker || rule.holding, controller.hideValues)}</strong>
            <span className={`mp-kind mp-rule-state mp-rule-state--${state.toLowerCase()}`}>{state}</span>
          </div>
          <div className="mp-rule-controls">
            <p className="mp-rule-condition" aria-label={`${privateValue(rule.holding, controller.hideValues)}: ${conditionLabel(rule)}`}>
              {!controller.hideValues && <svg className="mp-rule-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={rule.condition === 'price_above' ? 'M4 17l6-6 4 4 6-10M14 5h6v6' : rule.condition === 'price_below' ? 'M4 7l6 6 4-4 6 10M14 19h6v-6' : 'M3 12h4l3-7 4 14 3-7h4'} />
              </svg>}
              {conditionLabel(rule)}
            </p>
            <details className="mp-rule-menu" onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute('open')
            }} onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.currentTarget.removeAttribute('open')
              event.currentTarget.querySelector('summary')?.focus()
            }}>
              <summary aria-label={`Manage ${privateValue(rule.holding, controller.hideValues)} ${controller.hideValues ? 'watch rule' : `${conditionLabel(rule)} rule`}`} title="Manage rule">
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
                <button type="button" disabled={workspaceReadOnly} aria-label={`Delete ${privateValue(rule.holding, controller.hideValues)} ${controller.hideValues ? 'watch rule' : `${conditionLabel(rule)} rule`}`} onClick={() => controller.deleteRule(rule.id)}>Delete</button>
              </div>
            </details>
          </div>
          {!controller.hideValues && observation.quote && <p className="mp-rule-observation">
            {rule.condition === 'daily_move' ? `${observation.quote.changePct! > 0 ? '+' : ''}${observation.quote.changePct!.toFixed(2)}% day move` : numberFormatter({ style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(observation.quote.price)}
            {' · '}{observation.matched ? 'Condition met' : observation.distance === 0 ? 'At watch level' : observation.distance !== undefined ? `${observation.distance.toFixed(2)}${rule.condition === 'daily_move' ? ' pts' : '%'} to level` : 'Distance unavailable'}
            <br />{observation.quote.source === 'nav' ? 'Published NAV' : observation.quote.source === 'nse-close' ? 'NSE close' : 'Yahoo Finance'} · {dateFormatter({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(observation.quote.at)} IST
          </p>}
          {!controller.hideValues && observation.state === 'Waiting' && <p className="mp-rule-observation">{controller.allowExternalData ? 'Waiting for a recent provider observation.' : 'Waiting for market data to be enabled.'}</p>}
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
    {!controller.rules.length && <p className="mp-empty">{controller.positions.length ? 'Add a watch rule to follow a price or daily move.' : 'Import your holdings to add watch rules.'}</p>}
    <p className="mp-muted">Checked while Monitor is open.</p>
    <dialog className="mp-dialog" ref={dialog} aria-labelledby="mp-rule-title">
      <form className="mp-form" onSubmit={submit}>
        <div className="mp-section-head">
          <h2 id="mp-rule-title">{editing ? 'Edit watch rule' : 'Create a watch rule'}</h2>
          <button className="mp-icon-button" type="button" aria-label="Close rule form" onClick={() => dialog.current?.close()}>×</button>
        </div>
        <label className="mp-field">
          Holding
          <select autoFocus required value={holdingId} onChange={(event) => {
            setHoldingId(event.target.value)
            setThreshold(defaultThreshold(event.target.value, condition))
          }}>
            {!selected && <option value="">Choose a holding</option>}
            {controller.positions.map((position) => <option value={position.id} key={position.id}>{privateValue(position.name || position.ticker, controller.hideValues)}</option>)}
          </select>
        </label>
        <label className="mp-field">
          Condition
          <select value={condition} onChange={(event) => {
            const next = event.target.value as RuleCondition
            setCondition(next)
            setThreshold(defaultThreshold(holdingId, next))
          }}>
            {Object.entries(conditions).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label className="mp-field">
          {condition === 'daily_move' ? 'Move threshold (%)' : 'Price threshold (₹)'}
          <input type="number" required min="0.01" step="0.01" value={controller.hideValues ? '' : threshold} onChange={(event) => setThreshold(event.target.value)} />
        </label>
        <p className="mp-muted">{condition === 'daily_move' ? 'Checks the size of either an upward or downward daily move.' : controller.allowExternalData ? 'Uses a fresh provider quote only to suggest a starting level. Enter a value if no quote is available.' : 'External market data is off, so enter a price level manually.'} No background notification is sent.</p>
        {error && <p role="alert">{error}</p>}
        <div className="mp-actions">
          <button type="submit" disabled={workspaceReadOnly}>Save rule</button>
          <button type="button" onClick={() => dialog.current?.close()}>Cancel</button>
        </div>
      </form>
    </dialog>
  </section>
}
