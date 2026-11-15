// Local SIP tracking prototype. All changes are in memory.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useStore } from '../../useStore'
import { ActionIcon } from '../ActionIcon'
import { SipSelect } from './SipSelect'
import { FundSchemeReview, FundSchemeReviewContent } from '../FundSchemeReview'
import type { Position } from '../../types'
import type { FundSchemeCandidate } from '../../fundSchemes'
import { EQUITY_MF_MARKET_CALENDAR_2026, nextFundBusinessDate } from '../../fundBusinessDays'
import { isSipDate, isWeekendSipDate, nextSipDate, normalizeSipAmountInput, parseSipAmount } from './sipTrackingRules'
import './sipSettingsPrototype.css'

type Demo = 'demo' | 'empty' | 'waiting' | 'failure' | 'loading' | 'worst'
type Plan = { id: string; fundId: string; amount: number; day: number; start: string; account: string; method: string; paused: boolean; skipped: boolean }
type Draft = Omit<Plan, 'id' | 'paused' | 'skipped' | 'amount'> & { amount: string }

const FUNDS = [
  { id: 'pp', name: 'Parag Parikh Flexi Cap Fund', option: 'Direct · Growth', code: '122639', confirmed: true, calendar: EQUITY_MF_MARKET_CALENDAR_2026 },
  { id: 'hdfc', name: 'HDFC Nifty 50 Index Fund', option: 'Direct · Growth', code: '119063', confirmed: true, calendar: EQUITY_MF_MARKET_CALENDAR_2026 },
  { id: 'unconfirmed', name: 'Motilal Oswal Midcap Fund', option: 'Direct · Growth', code: '', confirmed: false, calendar: EQUITY_MF_MARKET_CALENDAR_2026 },
]
const ACCOUNTS = [
  { id: 'groww', name: 'Groww' },
  { id: 'zerodha', name: 'Zerodha Coin' },
  { id: 'angel', name: 'Angel One' },
  { id: 'indmoney', name: 'INDmoney' },
  { id: 'amc', name: 'Direct with AMC' },
  { id: 'other', name: 'Other provider' },
]
const PAYMENT_METHODS = ['Provider AutoPay', 'UPI mandate (AutoPay)', 'Bank mandate (e-NACH)', 'BSE mandate', 'Bank standing instruction', 'Manual payment', 'Other / Not sure']
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
const date = (value: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
const ordinal = (day: number) => `${day}${day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th')}`
const initialPlans = (): Plan[] => [
  { id: 'plan-pp', fundId: 'pp', amount: 5000, day: 5, start: '2026-12-05', account: 'groww', method: 'Provider AutoPay', paused: false, skipped: false },
  { id: 'plan-hdfc', fundId: 'hdfc', amount: 2500, day: 10, start: '2026-12-10', account: 'zerodha', method: 'UPI mandate (AutoPay)', paused: true, skipped: false },
]
function sampleReviewFunds(): Position[] {
  return FUNDS.map((fund) => ({
    id: fund.id, ticker: fund.code || fund.id, name: `${fund.name} Direct Plan Growth`, type: 'mutual-fund',
    quantity: 1, buyPrice: 100, invested: 100, lastPrice: 100,
    ...(fund.confirmed ? { mfScheme: { code: Number(fund.code), name: `${fund.name} Direct Plan Growth`, source: 'confirmed' as const } } : {}),
  }))
}
function projectedNavDate(fundId: string, scheduledDate: string) {
  return nextFundBusinessDate(scheduledDate, FUNDS.find((fund) => fund.id === fundId)?.calendar)
}
function navDateLabel(fundId: string, scheduledDate: string): string {
  const projected = projectedNavDate(fundId, scheduledDate)
  if (projected.status === 'invalid-date') return ''
  if (projected.status === 'calendar-unavailable') return `Estimated NAV pending: ${scheduledDate.slice(0, 4)} calendar unavailable.`
  return `Estimated NAV: ${date(projected.date)}${projected.rolledForward ? ' (next business day)' : ''}`
}
function blankDraft(fundId = 'pp'): Draft {
  return { fundId, amount: '', day: 5, start: '2026-12-05', account: 'groww', method: 'Provider AutoPay' }
}

export function SipSettingsPrototype() {
  const { settings, positions } = useStore()
  const hidden = settings.hideValues
  const initial = new URLSearchParams(window.location.search)
  const [demo, setDemo] = useState<Demo>(() => ['demo', 'empty', 'waiting', 'failure', 'loading', 'worst'].includes(initial.get('data') ?? '') ? initial.get('data') as Demo : 'demo')
  const [plans, setPlans] = useState<Plan[]>(() => initial.get('data') === 'empty' ? [] : initialPlans())
  const [sampleFunds, setSampleFunds] = useState<Position[]>(sampleReviewFunds)
  const importedFunds = positions.filter((position) => position.type === 'mutual-fund')
  const reviewFunds = importedFunds.length ? importedFunds : sampleFunds
  const [tab, setTab] = useState<'schemes' | 'sip'>('sip')
  const [expanded, setExpanded] = useState(false)
  const [editor, setEditor] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const editorTrigger = useRef<HTMLElement | null>(null)
  const prefix = useId()
  const mask = (value: string) => hidden ? '••••••' : value
  const fundName = (id: string) => demo === 'worst' && id === 'pp' ? 'Nippon India Nifty Smallcap 250 Momentum Quality 100 Index Fund' : FUNDS.find((fund) => fund.id === id)!.name
  const shownAmount = (plan: Plan) => demo === 'worst' && plan.id === 'plan-pp' ? 1234567.89 : plan.amount
  const active = plans.filter((plan) => !plan.paused)
  const monthly = active.reduce((total, plan) => total + shownAmount(plan), 0)
  const availableFunds = FUNDS.filter((fund) => sampleFunds.some((sample) => sample.id === fund.id && sample.mfScheme) && !plans.some((plan) => plan.fundId === fund.id))

  useEffect(() => {
    if (!editor || hidden) return
    content.current?.querySelector('.sip-editor')?.scrollIntoView({ block: 'start' })
    content.current?.querySelector<HTMLInputElement>('[data-sip-amount]')?.focus({ preventScroll: true })
  }, [editor, hidden])
  useEffect(() => {
    if (!deleteId || hidden) return
    const confirmation = content.current?.querySelector<HTMLElement>('.sip-delete')
    confirmation?.scrollIntoView({ block: 'nearest' })
    confirmation?.querySelector<HTMLButtonElement>('[data-sip-keep]')?.focus({ preventScroll: true })
  }, [deleteId, hidden])

  function changeDemo(next: Demo) {
    setDemo(next); setPlans(next === 'empty' ? [] : initialPlans()); setEditor(null); setSampleFunds(sampleReviewFunds()); setMessage(''); setError('')
    const url = new URL(window.location.href)
    url.searchParams.set('data', next)
    window.history.replaceState(window.history.state, '', url)
  }
  function openEditor(plan?: Plan) {
    const fundId = plan?.fundId ?? availableFunds[0]?.id
    if (!fundId) return
    editorTrigger.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
    setDraft(plan ? { ...plan, amount: String(plan.amount) } : blankDraft(fundId))
    setEditor(plan?.id ?? 'new'); setError(''); setMessage(''); setDeleteId(null)
  }
  function closeEditor() {
    setEditor(null); setError('')
    requestAnimationFrame(() => {
      const trigger = editorTrigger.current?.isConnected ? editorTrigger.current
        : content.current?.querySelector<HTMLButtonElement>(`[data-sip-edit="${draft.fundId}"]`) ?? addButton.current
      trigger?.focus({ preventScroll: true })
    })
  }
  function save(event: FormEvent) {
    event.preventDefault()
    const amount = parseSipAmount(draft.amount)
    if (amount === null) { setError('Enter ₹1 to ₹9,99,99,999.99, with up to two decimal places.'); return }
    if (!sampleFunds.find((fund) => fund.id === draft.fundId)?.mfScheme) { setError('Confirm this scheme before tracking a SIP.'); return }
    if (plans.some((plan) => plan.fundId === draft.fundId && plan.id !== editor)) { setError('This fund already has SIP tracking. Edit its existing setup.'); return }
    if (!isSipDate(draft.start) || draft.start < '2026-11-15') { setError('Choose a first instalment after 14 Nov 2026, the sample statement date.'); return }
    const id = editor === 'new' ? crypto.randomUUID() : editor!
    const existing = plans.find((plan) => plan.id === id)
    const plan: Plan = { ...draft, amount, id, paused: existing?.paused ?? false, skipped: existing?.skipped ?? false }
    setPlans((current) => existing ? current.map((item) => item.id === id ? plan : item) : [...current, plan])
    setMessage(existing ? 'SIP tracking updated.' : 'SIP tracking added. Unit additions remain pending.'); closeEditor()
  }
  function updatePlan(id: string, patch: Partial<Plan>, notice = '') {
    setPlans((current) => current.map((plan) => plan.id === id ? { ...plan, ...patch } : plan)); setMessage(notice)
  }
  async function confirmSampleScheme(holdingId: string, candidate: FundSchemeCandidate) {
    setSampleFunds((current) => current.map((fund) => fund.id === holdingId
      ? { ...fund, mfScheme: { code: candidate.schemeCode, name: candidate.schemeName, source: 'confirmed' } } : fund))
  }
  function changeAmount(value: string) {
    const normalized = normalizeSipAmountInput(value)
    if (normalized === null) { setError('Use up to eight digits before the decimal and two after it.'); return }
    setDraft({ ...draft, amount: normalized }); setError('')
  }
  function previewInstalment() {
    const plan = active[0]
    if (!plan) { setMessage('No active SIP instalments to check.'); return }
    const scheduled = nextSipDate(plan)
    const projected = projectedNavDate(plan.fundId, scheduled)
    const scheduledLabel = `${date(scheduled)}${isWeekendSipDate(scheduled) ? ' falls on a weekend' : ' is the scheduled date'}.`
    setMessage(`${scheduledLabel} ${navDateLabel(plan.fundId, scheduled)} ${projected.status === 'available' ? 'Actual NAV still depends on fund receipt and cut-off eligibility.' : 'A verified calendar is needed before selecting a date.'} No units added without a published, applicable NAV.`)

  }
  const editorForm = (fixedFund = editor !== 'new') => <form className="sip-editor" onSubmit={save} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeEditor() } }}>
    <div className="sip-editor-head"><div><h4>{editor === 'new' ? 'Track a monthly SIP' : 'Edit SIP tracking'}</h4><p>{fixedFund ? mask(`${fundName(draft.fundId)} · Direct · Growth`) : 'For a SIP you already have with your provider.'}</p></div><button className="sip-icon" type="button" aria-label="Close SIP editor" onClick={closeEditor}><ActionIcon name="close" /></button></div>
    <div className="sip-fields">
      {!fixedFund && <SipSelect label="Fund" value={draft.fundId} onChange={(fundId) => setDraft({ ...draft, fundId })} options={availableFunds.map((fund) => ({ value: fund.id, label: `${fundName(fund.id)} · ${fund.option}` }))} fullWidth description={`${fundName(draft.fundId)} · ${FUNDS.find((fund) => fund.id === draft.fundId)!.option}`} />}
      <label className="sip-field">Monthly amount<span className="sip-money-input"><span aria-hidden="true">₹</span><input data-sip-amount aria-label="Monthly SIP amount" inputMode="decimal" type="text" aria-describedby={`${prefix}-amount-limit`} placeholder="5,000" value={draft.amount} onChange={(event) => changeAmount(event.target.value)} /></span><span id={`${prefix}-amount-limit`}>Maximum ₹9,99,99,999.99.</span></label>
      <label className="sip-field">SIP date<input type="date" aria-describedby={`${prefix}-nav-date`} min="2026-11-15" value={draft.start} onChange={(event) => { const start = event.target.value; setDraft({ ...draft, start, day: start ? Number(start.slice(-2)) : draft.day }) }} /><span>{draft.start ? `${ordinal(draft.day)} of every month` : 'Choose the first instalment to track.'}</span><span id={`${prefix}-nav-date`} data-sip-nav-date>{navDateLabel(draft.fundId, draft.start)}</span></label>
      <SipSelect label="SIP provider" value={draft.account} onChange={(account) => setDraft({ ...draft, account })} options={ACCOUNTS.map((account) => ({ value: account.id, label: account.name, separatorBefore: account.id === 'amc' }))} />
      <SipSelect label="Payment method" value={draft.method} onChange={(method) => setDraft({ ...draft, method })} options={PAYMENT_METHODS.map((method) => ({ value: method, label: method, separatorBefore: method === 'Manual payment' }))} />
    </div>
    <p className="sip-note">Choose a first instalment after your latest statement.</p>
    {draft.day > 28 && <p className="sip-note">In shorter months, use the last calendar day. The scheme’s business-day rules still apply.</p>}
    <div className="sip-estimate-note"><ActionIcon name="latest" /><p><strong>NAV estimate uses the next business day.</strong> Weekends and listed holidays are skipped using the 2026 MF exchange calendar. Fund receipt and cut-off times can delay the actual NAV. An import confirms allotted units.</p></div>
    {error && <p className="sip-error" role="alert">{error}</p>}
    <div className="sip-form-actions"><button type="submit" className="btn btn--primary">{editor === 'new' ? 'Add SIP tracking' : 'Save changes'}</button><button type="button" className="btn btn--secondary" onClick={closeEditor}>Cancel</button></div>
  </form>

  const planActions = (plan: Plan) => <div className="sip-actions">
    <button type="button" data-sip-edit={plan.fundId} onClick={() => openEditor(plan)}>Edit</button>
    <button type="button" onClick={() => updatePlan(plan.id, { paused: !plan.paused })}>{plan.paused ? 'Resume tracking' : 'Pause tracking'}</button>
    {!plan.paused && <button type="button" onClick={() => updatePlan(plan.id, { skipped: !plan.skipped }, plan.skipped ? 'Next instalment restored.' : 'Next instalment skipped in Finverse.')}>{plan.skipped ? 'Undo skip' : 'Skip next'}</button>}
    <button type="button" className="sip-remove" onClick={() => setDeleteId(plan.id)}>Remove</button>
  </div>
  const deleteConfirmation = (plan: Plan) => deleteId === plan.id && <div className="sip-delete" role="group" aria-label={`Remove tracking for ${fundName(plan.fundId)}`}><p>Remove tracking for <strong>{fundName(plan.fundId)}</strong>?</p><div className="sip-actions"><button type="button" onClick={() => { setPlans((current) => current.filter((item) => item.id !== plan.id)); setDeleteId(null); setEditor(null); setMessage('SIP tracking removed.'); addButton.current?.focus() }}>Remove tracking</button><button type="button" data-sip-keep onClick={() => setDeleteId(null)}>Keep SIP</button></div></div>
  const planRow = (plan: Plan) => editor === plan.id ? editorForm(true) : <div className={`sip-plan${plan.paused ? ' sip-plan--paused' : ''}`} key={plan.id}>
    <div className="sip-plan-main"><div className="sip-plan-name"><span className="sip-fund-mark" aria-hidden="true">{plan.fundId === 'pp' ? 'P' : 'H'}</span><div><strong>{mask(fundName(plan.fundId))}</strong><span>{mask(`Direct · Growth · ${ACCOUNTS.find((account) => account.id === plan.account)!.name}`)}</span></div></div><div className="sip-plan-amount"><strong>{mask(money(shownAmount(plan)))}</strong><span>Every {ordinal(plan.day)}</span></div></div>
    <div className="sip-plan-context"><span className={`sip-state${plan.paused ? ' sip-state--paused' : ''}`}>{plan.paused ? 'Tracking paused' : plan.skipped ? 'Next instalment skipped' : 'Tracking active'}</span><span>{plan.paused ? 'No new contributions while paused' : `Next ${date(nextSipDate(plan))}`}</span>{!plan.paused && <span data-sip-plan-nav-date>{navDateLabel(plan.fundId, nextSipDate(plan))}</span>}</div>
    {planActions(plan)}{deleteConfirmation(plan)}
  </div>

  return <div className="sip-prototype" data-variant="C">
    <div className="sip-prototype-caption"><span>Prototype</span><span>{importedFunds.length ? 'SIP changes reset on reload · Scheme approvals are saved' : 'Sample data · Changes reset on reload'}</span>
    <aside className="sip-prototype-bar" aria-label="SIP prototype controls" onClick={(event) => event.stopPropagation()}>
      <details className="sip-demo-controls"><summary>Demo tools</summary><div className="sip-demo-panel">
        <label>Sample state<select aria-label="Prototype data" value={demo} onChange={(event) => changeDemo(event.target.value as Demo)}><option value="demo">Demo data</option><option value="worst">Worst case</option><option value="empty">Empty</option><option value="waiting">Waiting for NAV</option><option value="failure">NAV failure</option><option value="loading">Loading</option></select></label>
        <button type="button" disabled={hidden || !active.length} onClick={previewInstalment}>Check pending instalment</button>
        <details><summary>View state</summary><pre>{JSON.stringify({ demo, plans: hidden ? 'Hidden' : plans }, null, 2)}</pre></details>
      </div></details>
    </aside>
    </div>
    <details className="listing-review fund-review sip-schemes" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary className="listing-review-trigger"><ActionIcon name="review" /><span className="listing-review-copy"><strong>Mutual-fund schemes</strong><span>{hidden ? 'Scheme and SIP details hidden.' : `${reviewFunds.length} scheme${reviewFunds.length === 1 ? '' : 's'} · ${plans.length} sample SIP${plans.length === 1 ? '' : 's'}`}</span></span><span className="listing-review-action">{expanded ? 'Close schemes' : 'View schemes'}</span><svg className="listing-review-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></summary>
      <div className="sip-content" ref={content}>
        {hidden ? <div className="sip-hidden"><ActionIcon name="privacy" /><p>Reveal portfolio values to view schemes and manage SIP tracking.</p></div> : <>
          <div className="sip-tabs" role="tablist" aria-label="Mutual-fund settings">{(['schemes', 'sip'] as const).map((item) => <button type="button" role="tab" key={item} id={`${prefix}-${item}-tab`} aria-selected={tab === item} aria-controls={`${prefix}-panel`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'schemes' : event.key === 'End' ? 'sip' : tab === 'sip' ? 'schemes' : 'sip'; setTab(next); document.getElementById(`${prefix}-${next}-tab`)?.focus() } }}>{item === 'schemes' ? 'Scheme matches' : 'Recurring SIPs'}</button>)}</div>
          <section role="tabpanel" id={`${prefix}-panel`} aria-labelledby={`${prefix}-${tab}-tab`}>
            {tab === 'schemes' ? (
              importedFunds.length ? <FundSchemeReview embedded />
                : <FundSchemeReviewContent funds={sampleFunds} settings={settings} confirmFundScheme={confirmSampleScheme} embedded />
            ) : <>
              <div className="sip-section-head"><div><h3>Recurring SIPs</h3><p>Your existing SIPs, tracked between imports.</p></div>{availableFunds.length > 0 && <button ref={addButton} type="button" className="btn btn--primary" onClick={() => openEditor()} disabled={demo === 'loading'}>+ Add SIP</button>}</div>
              <div className="sip-monthly"><span>Monthly contribution</span><strong>{mask(money(monthly))}<span> / month</span></strong><span>{active.length} active · {plans.length - active.length} paused</span></div>
              {!editor && <p className="sip-intro">Track your existing schedules here. Unit additions need an applicable dated NAV and statement reconciliation.</p>}
              {demo === 'loading' ? <div className="sip-feedback" role="status">Loading your SIP schedules…</div> : <>
                {(demo === 'waiting' || demo === 'failure') && <div className={`sip-feedback${demo === 'failure' ? ' sip-feedback--error' : ''}`} role={demo === 'failure' ? 'alert' : 'status'}><ActionIcon name={demo === 'failure' ? 'warning' : 'latest'} /><div><strong>{demo === 'failure' ? 'NAV unavailable. No units added.' : 'Waiting for a dated NAV.'}</strong><p>{demo === 'failure' ? 'Your schedule is saved. Retry when the NAV source is available.' : 'The next contribution stays pending until its expected NAV is published.'}</p></div>{demo === 'failure' && <button type="button" className="btn btn--secondary" onClick={() => { setDemo('waiting'); setMessage('Retry requested in this prototype.') }}>Try again</button>}</div>}
                {plans.length === 0 && !editor && <div className="sip-empty"><ActionIcon name="calendar" /><h4>Track your recurring SIP.</h4><p>Save the amount and date. Unit additions stay pending until an applicable dated NAV is available.</p><button type="button" className="btn btn--secondary" onClick={() => openEditor()}>Track your first SIP</button></div>}
                <div className="sip-in-place">{editor === 'new' && editorForm()}{plans.map((plan) => <div className="sip-inline-fund" key={plan.id}>{planRow(plan)}</div>)}</div>
              </>}
              {message && <p className="sip-message" role="status">{message}</p>}
              <details className="sip-disclaimer" aria-labelledby={`${prefix}-disclaimer`}>
                <summary><ActionIcon name="warning" /><span id={`${prefix}-disclaimer`}>Disclaimer</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></summary>
                <p>Estimated NAV dates, prices and units may differ from your provider. Actual allotment depends on the scheme, plan/option, fund receipt and cut-off time. Confirm final values against your provider or AMC statement.</p>
              </details>
            </>}
          </section>
        </>}
      </div>
    </details>

  </div>
}
