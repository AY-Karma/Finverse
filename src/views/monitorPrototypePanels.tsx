// Throwaway Monitor interactions. All examples and changes live only in memory.
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'

type AlertState = 'open' | 'reviewed' | 'snoozed'
type Condition = 'price_above' | 'price_below' | 'daily_move'
type SampleAlert = {
  id: string
  holding: string
  title: string
  reason: string
  evidence: string
  kind: 'price' | 'disclosure'
  state: AlertState
  time: string
  metrics?: { label: string; value: string; trend?: 'up' | 'down' | 'neutral' }[]
}
type SampleRule = {
  id: string
  holding: string
  condition: Condition
  threshold: number
  active: boolean
}
type SampleEvent = {
  id: string
  holding: string
  title: string
  date: string
  kind: 'Results' | 'Dividend' | 'Reminder' | 'Scheme update'
  reminder: boolean
}
const holdings = ['HDFC Bank', 'TCS', 'Parag Parikh Flexi Cap']
const conditions: Record<Condition, string> = {
  price_above: 'Price above',
  price_below: 'Price below',
  daily_move: 'Daily move exceeds',
}
const amount = (value: number) =>
  `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const conditionLabel = (rule: SampleRule) =>
  `${conditions[rule.condition]} ${rule.condition === 'daily_move' ? `${rule.threshold}%` : amount(rule.threshold)}`
const initialAlerts: SampleAlert[] = [
  {
    id: 'a1',
    holding: 'HDFC Bank',
    title: 'Price is above your level',
    reason: 'Sample price ₹1,664 is above your ₹1,650 watch level.',
    evidence:
      'Simulated quote at 09:42 on 1 Oct 2026: ₹1,664. Rule: price above ₹1,650. This is invented data, not a current market quote.',
    kind: 'price',
    state: 'open',
    time: '09:42',
    metrics: [
      { label: 'Sample price', value: '₹1,664' },
      { label: 'Watch level', value: '₹1,650' },
      { label: 'Above level', value: '+₹14', trend: 'up' },
    ],
  },
  {
    id: 'a2',
    holding: 'Parag Parikh Flexi Cap',
    title: 'Example scheme disclosure',
    reason:
      'A sample scheme update was added for a fund in the example portfolio.',
    evidence:
      'Example disclosure: an invented fee-change notice, with a proposed effective date of 15 Oct 2026. No AMC announcement or real filing is attached. This scenario demonstrates where a verified source would appear.',
    kind: 'disclosure',
    state: 'open',
    time: '09:15',
    metrics: [
      { label: 'Notice type', value: 'Scheme terms' },
      { label: 'Effective', value: '15 Oct' },
      { label: 'Next step', value: 'Review notice', trend: 'neutral' },
    ],
  },
  {
    id: 'a3',
    holding: 'TCS',
    title: 'Daily move exceeds 3%',
    reason:
      'Sample daily change of −3.4% exceeded your absolute-move threshold of 3%.',
    evidence:
      'Simulated previous close ₹3,250; sample price ₹3,139.50; change −3.4%. The rule checks the size of either an upward or downward move. All values are invented.',
    kind: 'price',
    state: 'reviewed',
    time: '08:55',
    metrics: [
      { label: 'Sample price', value: '₹3,139.50' },
      { label: 'Daily move', value: '−3.4%', trend: 'down' },
      { label: 'Watch threshold', value: '±3%' },
    ],
  },
]
const initialRules: SampleRule[] = [
  {
    id: 'r1',
    holding: 'HDFC Bank',
    condition: 'price_above',
    threshold: 1650,
    active: true,
  },
  {
    id: 'r2',
    holding: 'TCS',
    condition: 'daily_move',
    threshold: 3,
    active: true,
  },
  {
    id: 'r3',
    holding: 'TCS',
    condition: 'price_below',
    threshold: 3000,
    active: false,
  },
]
const initialEvents: SampleEvent[] = [
  {
    id: 'e1',
    holding: 'TCS',
    title: 'Example results meeting',
    date: '2026-10-05',
    kind: 'Results',
    reminder: true,
  },
  {
    id: 'e2',
    holding: 'HDFC Bank',
    title: 'Example dividend ex-date',
    date: '2026-10-07',
    kind: 'Dividend',
    reminder: false,
  },
  {
    id: 'e3',
    holding: 'Parag Parikh Flexi Cap',
    title: 'Review example scheme update',
    date: '2026-10-15',
    kind: 'Scheme update',
    reminder: false,
  },
  {
    id: 'e4',
    holding: 'My portfolio',
    title: 'Review my watch levels',
    date: '2026-10-22',
    kind: 'Reminder',
    reminder: true,
  },
]
export function useMonitorPrototype() {
  const [alerts, setAlerts] = useState(initialAlerts)
  const [rules, setRules] = useState(initialRules)
  const [events, setEvents] = useState(initialEvents)
  const [statusMessage, setStatusMessage] = useState(
    'Sample portfolio loaded. Nothing here changes your holdings.',
  )
  const sequence = useRef(0)
  const checkedObservations = useRef(new Set<string>())
  const counts = {
    open: alerts.filter((item) => item.state === 'open').length,
    reviewed: alerts.filter((item) => item.state === 'reviewed').length,
    snoozed: alerts.filter((item) => item.state === 'snoozed').length,
    activeRules: rules.filter((rule) => rule.active).length,
    upcoming: events.filter(
      (event) => event.date >= '2026-10-01' && event.date <= '2026-10-30',
    ).length,
  }
  function setAlertState(id: string, state: AlertState) {
    setAlerts((items) =>
      items.map((item) => (item.id === id ? { ...item, state } : item)),
    )
    setStatusMessage(
      state === 'snoozed'
        ? 'Moved to Snoozed. Reopen it whenever you want in this preview.'
        : state === 'reviewed'
          ? 'Marked reviewed. It stays in your history.'
          : 'Reopened in Needs attention.',
    )
  }
  function saveRule(rule: SampleRule) {
    setRules((items) =>
      items.some((item) => item.id === rule.id)
        ? items.map((item) => (item.id === rule.id ? rule : item))
        : [...items, rule],
    )
    setStatusMessage('Watch rule saved. Use Refresh sample to try it.')
  }
  function toggleRule(id: string) {
    setRules((items) =>
      items.map((item) =>
        item.id === id ? { ...item, active: !item.active } : item,
      ),
    )
    setStatusMessage(
      'Watch rule updated. Paused rules do not create simulated alerts.',
    )
  }
  function deleteRule(id: string) {
    setRules((items) => items.filter((item) => item.id !== id))
    setStatusMessage('Sample rule removed. Existing alert history is kept.')
  }
  function addReminder(holding: string, title: string, date: string) {
    const reminder: SampleEvent = {
      id: `reminder-${++sequence.current}`,
      holding,
      title,
      date,
      kind: 'Reminder',
      reminder: true,
    }
    setEvents((items) =>
      [...items, reminder].sort((a, b) => a.date.localeCompare(b.date)),
    )
    setStatusMessage(
      'Reminder added to the sample calendar. No notification is scheduled.',
    )
  }
  function toggleReminder(id: string) {
    setEvents((items) =>
      items.map((item) =>
        item.id === id ? { ...item, reminder: !item.reminder } : item,
      ),
    )
    setStatusMessage(
      'Sample reminder preference updated. No notification is scheduled.',
    )
  }
  function simulateRefresh() {
    const round = ++sequence.current
    const snapshots: Record<string, { price: number; move: number }> = {
      'HDFC Bank': { price: 1712, move: 2.8 },
      TCS: { price: 3138, move: -3.6 },
      'Parag Parikh Flexi Cap': { price: 95, move: 0.4 },
    }
    const fresh: SampleAlert[] = rules
      .filter((rule) => rule.active)
      .flatMap((rule) => {
        const quote = snapshots[rule.holding]
        const triggered =
          rule.condition === 'price_above'
            ? quote.price > rule.threshold
            : rule.condition === 'price_below'
              ? quote.price < rule.threshold
              : Math.abs(quote.move) > rule.threshold
        if (!triggered) return []
        const observation = [
          rule.id,
          rule.holding,
          rule.condition,
          rule.threshold,
          quote.price,
          quote.move,
        ].join('|')
        if (checkedObservations.current.has(observation)) return []
        checkedObservations.current.add(observation)
        const observed =
          rule.condition === 'daily_move'
            ? `${quote.move}%`
            : amount(quote.price)
        return [
          {
            id: `${rule.id}-refresh-${round}`,
            holding: rule.holding,
            title:
              rule.condition === 'daily_move'
                ? 'Daily move exceeds your threshold'
                : `Price is ${rule.condition === 'price_above' ? 'above' : 'below'} your level`,
            reason: `Sample ${rule.condition === 'daily_move' ? 'daily move' : 'price'} ${observed}. Your rule: ${conditionLabel(rule).toLowerCase()}.`,
            evidence: `Refresh ${round} uses a fixed, invented snapshot. Price ${amount(quote.price)}, daily change ${quote.move}%. Rule: ${conditionLabel(rule)}. This is not a live quote or background monitor.`,
            kind: 'price',
            state: 'open',
            time: 'Just now',
            metrics: [
              { label: 'Sample price', value: amount(quote.price) },
              {
                label: 'Daily move',
                value: `${quote.move > 0 ? '+' : ''}${quote.move}%`,
                trend: quote.move > 0 ? 'up' : quote.move < 0 ? 'down' : 'neutral',
              },
              {
                label: 'Watch threshold',
                value: rule.condition === 'daily_move' ? `±${rule.threshold}%` : amount(rule.threshold),
              },
            ],
          },
        ]
      })
    setAlerts((items) => [...fresh, ...items])
    setStatusMessage(
      fresh.length
        ? `${fresh.length} sample alert${fresh.length === 1 ? '' : 's'} added from active rules. This refresh uses an invented quote snapshot.`
        : 'No new sample alerts. Active rules already triggered for this snapshot, or do not match it.',
    )
  }
  function reset() {
    setAlerts(initialAlerts)
    setRules(initialRules)
    setEvents(initialEvents)
    sequence.current = 0
    checkedObservations.current.clear()
    setStatusMessage(
      'Sample reset. Rules, reminders and alert history are back to the starting state.',
    )
  }
  return {
    alerts,
    rules,
    events,
    counts,
    statusMessage,
    reset,
    simulateRefresh,
    setAlertState,
    saveRule,
    toggleRule,
    deleteRule,
    addReminder,
    toggleReminder,
  }
}
export type MonitorPrototypeController = ReturnType<typeof useMonitorPrototype>
type PanelProps = { controller: MonitorPrototypeController }

export function ReminderAction({
  controller,
  onAdded,
}: PanelProps & { onAdded?: (date: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [date, setDate] = useState('2026-10-08')
  const [title, setTitle] = useState('')
  const [holding, setHolding] = useState('My portfolio')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim()) return
    controller.addReminder(holding, title.trim(), date)
    onAdded?.(date)
    setTitle('')
    dialog.current?.close()
  }
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()}>
        + Reminder
      </button>
      <dialog
        className="mp-dialog"
        ref={dialog}
        aria-labelledby="mp-reminder-title"
      >
        <form className="mp-form" onSubmit={submit}>
          <div className="mp-section-head">
            <h2 id="mp-reminder-title">Add a sample reminder</h2>
            <button
              className="mp-icon-button"
              type="button"
              aria-label="Close reminder form"
              onClick={() => dialog.current?.close()}
            >
              ×
            </button>
          </div>
          <p className="mp-muted">
            Saved only in this preview. No notification will be sent.
          </p>
          <label className="mp-field">
            About
            <select
              value={holding}
              onChange={(event) => setHolding(event.target.value)}
            >
              {['My portfolio', ...holdings].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="mp-field">
            Reminder
            <input
              autoFocus
              required
              maxLength={100}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Review my watch levels"
            />
          </label>
          <label className="mp-field">
            Date
            <input
              type="date"
              required
              min="2026-10-01"
              max="2026-10-30"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <div className="mp-actions">
            <button type="submit">Add reminder</button>
            <button type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

export function RulesPanel({ controller }: PanelProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [editing, setEditing] = useState<SampleRule | null>(null)
  const [holding, setHolding] = useState(holdings[0])
  const [condition, setCondition] = useState<Condition>('price_above')
  const [threshold, setThreshold] = useState('1700')
  const sequence = useRef(0)
  function open(rule: SampleRule | null = null) {
    setEditing(rule)
    setHolding(rule?.holding ?? holdings[0])
    setCondition(rule?.condition ?? 'price_above')
    setThreshold(String(rule?.threshold ?? 1700))
    dialog.current?.showModal()
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(threshold)
    if (!Number.isFinite(value) || value <= 0) return
    controller.saveRule({
      id: editing?.id ?? `custom-${Date.now()}-${++sequence.current}`,
      holding,
      condition,
      threshold: value,
      active: editing?.active ?? true,
    })
    dialog.current?.close()
  }
  return (
    <section className="mp-rules-panel">
      <div className="mp-section-head">
        <div>
          <h2>Your watch rules</h2>
        </div>
        <button type="button" onClick={() => open()}>
          + New rule
        </button>
      </div>
      <div className="mp-rule-list">
        {controller.rules.map((rule) => (
          <article
            className={`mp-rule-row${rule.active ? '' : ' mp-rule-paused'}`}
            key={rule.id}
          >
            <div className="mp-row-main">
              <div className="mp-rule-summary">
                <strong>{rule.holding}</strong>
                <span className={`mp-kind mp-rule-state mp-rule-state--${rule.active ? 'active' : 'paused'}`}>
                  {rule.active ? 'Active' : 'Paused'}
                </span>
              </div>
              <div className="mp-rule-controls">
                <p className="mp-rule-condition">
                  <svg className="mp-rule-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={rule.condition === 'price_above' ? 'M4 17l6-6 4 4 6-10M14 5h6v6' : rule.condition === 'price_below' ? 'M4 7l6 6 4-4 6 10M14 19h6v-6' : 'M3 12h4l3-7 4 14 3-7h4'} />
                  </svg>
                  {conditionLabel(rule)}
                </p>
                <details className="mp-rule-menu" onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.removeAttribute('open')
                }} onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.currentTarget.removeAttribute('open')
                  event.currentTarget.querySelector('summary')?.focus()
                }}>
                  <summary aria-label={`Manage ${rule.holding} ${conditionLabel(rule)} rule`} title="Manage rule">
                    <svg className="mp-rule-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                  </summary>
                  <div className="mp-rule-menu-actions">
                    <button type="button" onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      open(rule)
                    }}>Edit</button>
                    <button type="button" onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      controller.toggleRule(rule.id)
                    }}>{rule.active ? 'Pause' : 'Resume'}</button>
                    <button type="button" aria-label={`Delete ${rule.holding} ${conditionLabel(rule)} rule`} onClick={() => controller.deleteRule(rule.id)}>Delete</button>
                  </div>
                </details>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!controller.rules.length && (
        <p className="mp-empty">
          Add a rule, then simulate a refresh to try a trigger.
        </p>
      )}
      <p className="mp-muted">
        Sample rules. Run with Refresh sample.
      </p>
      <dialog
        className="mp-dialog"
        ref={dialog}
        aria-labelledby="mp-rule-title"
      >
        <form className="mp-form" onSubmit={submit}>
          <div className="mp-section-head">
            <h2 id="mp-rule-title">
              {editing ? 'Edit sample rule' : 'Create a sample rule'}
            </h2>
            <button
              className="mp-icon-button"
              type="button"
              aria-label="Close rule form"
              onClick={() => dialog.current?.close()}
            >
              ×
            </button>
          </div>
          <label className="mp-field">
            Sample holding
            <select
              autoFocus
              value={holding}
              onChange={(event) => setHolding(event.target.value)}
            >
              {holdings.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="mp-field">
            Condition
            <select
              value={condition}
              onChange={(event) =>
                setCondition(event.target.value as Condition)
              }
            >
              {Object.entries(conditions).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="mp-field">
            {condition === 'daily_move'
              ? 'Move threshold (%)'
              : 'Price threshold (₹)'}
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
          </label>
          <p className="mp-muted">
            The simulation checks HDFC Bank at ₹1,712, TCS at ₹3,138 and the
            sample fund at ₹95. Daily moves are +2.8%, −3.6% and +0.4%.
          </p>
          <div className="mp-actions">
            <button type="submit">Save rule</button>
            <button type="button" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </section>
  )
}
