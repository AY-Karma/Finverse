import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useStore } from '../useStore'
import { useMonitor } from '../useMonitor'
import { privateValue } from '../privacy'
import { hasCompatibleFundScheme } from '../fundSchemes'
import { EQUITY_MF_MARKET_CALENDAR_2026, nextFundBusinessDate } from '../fundBusinessDays'
import {
  SIP_PAYMENT_METHODS, SIP_PROVIDERS, isSipDate, istToday, normalizeSipAmountInput, parseSipAmount, pendingSipDate, sipDateOnOrAfter, sipSchedule, type SipPlan,
} from '../sipPlans'
import { ActionIcon } from './ActionIcon'
import { SipSelect } from './SipSelect'
import { FundSchemeReview } from './FundSchemeReview'
import './sipSettings.css'

type Scheme = { code: number; name: string; usesEquityCalendar: boolean }
type Draft = { schemeCode: number; amount: string; day: number; start: string; provider: string; method: string }

const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
const longDate = (value: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
const ordinal = (day: number) => `${day}${day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th')}`
const navMoney = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)
const unitCount = (value: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value)
const providerName = (id: string) => SIP_PROVIDERS.find((provider) => provider.id === id)?.name ?? 'Other provider'
// The exchange calendar suits domestic equity schemes; liquid and overnight funds follow different allotment rules.
const usesEquityCalendar = (name: string, category = '') => !/\b(liquid|overnight)\b/i.test(`${name} ${category}`)

/** Mutual-fund scheme confirmation and, as its own setting below it, recurring SIP tracking. */
export function SipSettings() {
  const { positions, settings } = useStore()
  const controller = useMonitor()
  const hidden = settings.hideValues
  const funds = positions.filter((position) => position.type === 'mutual-fund')
  const schemes: Scheme[] = [...new Map(funds.filter(hasCompatibleFundScheme)
    .map((fund) => [fund.mfScheme!.code, { code: fund.mfScheme!.code, name: fund.mfScheme!.name, usesEquityCalendar: usesEquityCalendar(fund.mfScheme!.name, fund.category) }])).values()]
  const plans = controller.sipPlans
  const today = istToday(controller.now)
  const available = schemes.filter((scheme) => !plans.some((plan) => plan.schemeCode === scheme.code))
  const [editor, setEditor] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [historyId, setHistoryId] = useState<string | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const editorTrigger = useRef<HTMLElement | null>(null)
  const prefix = useId()
  const mask = (value: string) => privateValue(value, hidden)
  const readOnly = controller.readOnly
  const active = plans.filter((plan) => !plan.paused)
  const monthly = active.reduce((total, plan) => total + plan.amount, 0)

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

  if (!funds.length) return null

  const schemeFor = (code: number) => schemes.find((scheme) => scheme.code === code)
  const planName = (plan: Pick<SipPlan, 'schemeCode' | 'schemeName'>) => schemeFor(plan.schemeCode)?.name ?? plan.schemeName
  function navEstimate(code: number, scheduled: string): { text: string; title: string } | null {
    if (schemeFor(code)?.usesEquityCalendar === false) return null
    const projected = nextFundBusinessDate(scheduled, EQUITY_MF_MARKET_CALENDAR_2026)
    if (projected.status === 'invalid-date') return null
    if (projected.status === 'calendar-unavailable') return { text: 'NAV date pending', title: `Estimated NAV pending: ${scheduled.slice(0, 4)} calendar unavailable.` }
    const title = `Estimated NAV: ${longDate(projected.date)}${projected.rolledForward ? ' (next business day)' : ''}`
    return projected.date === scheduled ? { text: '', title } : { text: `NAV est. ${shortDate(projected.date)}`, title }
  }
  /** "5 Dec", or "5 Jan 2027" outside the current year. */
  function shortDate(value: string): string {
    const sameYear = value.slice(0, 4) === today.slice(0, 4)
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
  }

  function openEditor(plan?: SipPlan) {
    const code = plan?.schemeCode ?? available[0]?.code
    if (!code) return
    editorTrigger.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null
    setDraft(plan
      ? { schemeCode: plan.schemeCode, amount: String(plan.amount), day: plan.day, start: sipDateOnOrAfter(plan, today), provider: plan.provider, method: plan.method }
      : { schemeCode: code, amount: '', day: 5, start: sipDateOnOrAfter({ start: today, day: 5 }, today), provider: 'groww', method: SIP_PAYMENT_METHODS[0] })
    setEditor(plan?.id ?? 'new'); setError(''); setMessage(''); setDeleteId(null)
  }
  function closeEditor() {
    const code = draft?.schemeCode
    setEditor(null); setError('')
    requestAnimationFrame(() => {
      const trigger = editorTrigger.current?.isConnected ? editorTrigger.current
        : content.current?.querySelector<HTMLButtonElement>(`[data-sip-edit="${code}"]`) ?? addButton.current
      trigger?.focus({ preventScroll: true })
    })
  }
  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || !editor) return
    const amount = parseSipAmount(draft.amount)
    if (amount === null) { setError('Enter ₹1 to ₹9,99,99,999.99, with up to two decimal places.'); return }
    const existing = plans.find((plan) => plan.id === editor)
    const scheme = schemeFor(draft.schemeCode)
    if (!scheme && !existing) { setError('Confirm this scheme before tracking a SIP.'); return }
    if (!isSipDate(draft.start) || draft.start < today) { setError('Choose today or a later date for the next instalment.'); return }
    const plan: SipPlan = {
      id: existing?.id ?? crypto.randomUUID(), schemeCode: draft.schemeCode, schemeName: scheme?.name ?? existing!.schemeName,
      amount, day: draft.day, start: draft.start, provider: draft.provider, method: draft.method, paused: existing?.paused ?? false,
      ...(existing?.instalments ? { instalments: existing.instalments } : {}),
    }
    if (!controller.saveSipPlan(plan)) { setError(controller.statusMessage || 'SIP tracking could not be saved.'); return }
    setMessage(existing ? 'SIP tracking updated.' : 'SIP tracking added.'); closeEditor()
  }
  function update(plan: SipPlan, patch: Partial<SipPlan>, notice = '') {
    const { skipDate: _skip, ...rest } = plan
    const next = { ...rest, ...patch }
    if (!controller.saveSipPlan(next)) { setMessage(controller.statusMessage || 'SIP tracking could not be updated.'); return }
    setMessage(notice)
  }
  function changeAmount(value: string) {
    const normalized = normalizeSipAmountInput(value)
    if (normalized === null) { setError('Use up to eight digits before the decimal and two after it.'); return }
    setDraft((current) => current && { ...current, amount: normalized }); setError('')
  }

  const editorForm = (fixedScheme: boolean) => draft && <form className="sip-editor" onSubmit={save} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); closeEditor() } }}>
    <div className="sip-editor-head"><div><h4>{editor === 'new' ? 'Track a monthly SIP' : 'Edit SIP tracking'}</h4><p>{fixedScheme ? mask(planName({ schemeCode: draft.schemeCode, schemeName: plans.find((plan) => plan.id === editor)?.schemeName ?? '' })) : 'For a SIP you already have with your provider.'}</p></div><button className="sip-icon" type="button" aria-label="Close SIP editor" onClick={closeEditor}><ActionIcon name="close" /></button></div>
    <div className="sip-fields">
      {!fixedScheme && <SipSelect label="Fund" value={String(draft.schemeCode)} onChange={(code) => setDraft({ ...draft, schemeCode: Number(code) })} options={available.map((scheme) => ({ value: String(scheme.code), label: scheme.name }))} fullWidth description={schemeFor(draft.schemeCode)?.name} />}
      <label className="sip-field">Monthly amount<span className="sip-money-input"><span aria-hidden="true">₹</span><input data-sip-amount aria-label="Monthly SIP amount" inputMode="decimal" type="text" aria-describedby={`${prefix}-amount-limit`} placeholder="5,000" value={draft.amount} onChange={(event) => changeAmount(event.target.value)} /></span><span id={`${prefix}-amount-limit`}>Maximum ₹9,99,99,999.99.</span></label>
      <label className="sip-field">Next instalment<input type="date" aria-describedby={`${prefix}-nav-date`} min={today} value={draft.start} onChange={(event) => { const start = event.target.value; setDraft({ ...draft, start, day: start ? Number(start.slice(-2)) : draft.day }) }} /><span>{draft.start ? `${ordinal(draft.day)} of every month` : 'Choose your next instalment.'}</span><span id={`${prefix}-nav-date`} data-sip-nav-date>{draft.start ? navEstimate(draft.schemeCode, draft.start)?.title ?? '' : ''}</span></label>
      <SipSelect label="SIP provider" value={draft.provider} onChange={(provider) => setDraft({ ...draft, provider })} options={SIP_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.name, separatorBefore: provider.id === 'amc' }))} />
      <SipSelect label="Payment method" value={draft.method} onChange={(method) => setDraft({ ...draft, method })} options={SIP_PAYMENT_METHODS.map((method) => ({ value: method, label: method, separatorBefore: method === 'Manual payment' }))} />
    </div>
    {draft.day > 28 && <p className="sip-note">In shorter months, the last calendar day is used. The scheme’s business-day rules still apply.</p>}
    {schemeFor(draft.schemeCode)?.usesEquityCalendar !== false && <div className="sip-estimate-note"><ActionIcon name="latest" /><p>NAV date estimate: next business day on the 2026 MF exchange calendar.</p></div>}
    {error && <p className="sip-error" role="alert">{error}</p>}
    <div className="sip-form-actions"><button type="submit" className="btn btn--primary" disabled={readOnly}>{editor === 'new' ? 'Add SIP tracking' : 'Save changes'}</button><button type="button" className="btn btn--secondary" onClick={closeEditor}>Cancel</button></div>
  </form>

  const planRow = (plan: SipPlan) => {
    if (editor === plan.id) return editorForm(true)
    const name = planName(plan)
    const schedule = sipSchedule(plan, today)
    const state = plan.paused ? 'paused' : schedule.skipped ? 'skipped' : 'active'
    const nav = state === 'paused' ? null : navEstimate(plan.schemeCode, schedule.next)
    // An import that pins down the allotment replaces the estimate.
    const recorded = (plan.instalments ?? []).flatMap((item) => item.status === 'recorded' ? [{ ...item, units: item.imported?.units ?? item.units, nav: item.imported?.nav ?? item.nav }] : [])
    const last = recorded.at(-1)
    const pending = pendingSipDate(plan, today)
    const showHistory = historyId === plan.id && !!plan.instalments?.length
    return <div className={`sip-plan${plan.paused ? ' sip-plan--paused' : ''}`}>
      <div className="sip-plan-main"><div className="sip-plan-name"><span className="sip-fund-mark" aria-hidden="true">{hidden ? '•' : name.charAt(0).toUpperCase()}</span><div><strong>{mask(name)}</strong><span>{mask(providerName(plan.provider))}{!schemeFor(plan.schemeCode) && ' · Not in current holdings'}</span></div></div><div className="sip-plan-amount"><strong>{mask(money(plan.amount))}</strong><span>Every {ordinal(plan.day)}</span></div></div>
      <p className="sip-plan-context" data-state={state}>
        <span className={`sip-state sip-state--${state}`}>{state === 'paused' ? 'Paused' : state === 'skipped' ? `Skipped ${shortDate(schedule.skipped!)}` : 'Active'}</span>
        {state !== 'paused' && <span className={state === 'skipped' ? 'sip-next-after-skip' : undefined}>Next {shortDate(schedule.next)}</span>}
        {nav?.text && <span data-sip-plan-nav-date title={nav.title}>{nav.text}</span>}
      </p>
      {(pending || last) && <p className="sip-plan-record" data-pending={!!pending}>
        {pending ? <>{shortDate(pending)} instalment · awaiting NAV</>
          : <>Last {shortDate(last!.date)}<span className="sip-record-nav"> · NAV {mask(navMoney(last!.nav))}{last!.navDate !== last!.date && ` on ${shortDate(last!.navDate)}`}</span> · {mask(`${unitCount(last!.units)} units`)}{last!.imported ? ` · in ${shortDate(last!.imported.statementDate)} import` : ' est.'}</>}
      </p>}
      <div className="sip-actions">
        <button type="button" data-sip-edit={plan.schemeCode} disabled={readOnly} onClick={() => openEditor(plan)}>Edit</button>
        <button type="button" disabled={readOnly} aria-label={`${plan.paused ? 'Resume' : 'Pause'} tracking for ${mask(name)}`} onClick={() => update(plan, plan.paused ? { paused: false, start: sipDateOnOrAfter(plan, today) } : { paused: true })}>{plan.paused ? 'Resume' : 'Pause'}</button>
        {!plan.paused && <button type="button" disabled={readOnly} onClick={() => update(plan, schedule.skipped ? {} : { skipDate: schedule.next }, schedule.skipped ? 'Next instalment restored.' : 'Next instalment skipped in Finverse.')}>{schedule.skipped ? 'Undo skip' : 'Skip next'}</button>}
        {!!plan.instalments?.length && <button type="button" aria-expanded={showHistory} onClick={() => setHistoryId(showHistory ? null : plan.id)}>History ({plan.instalments.length})</button>}
        <button type="button" className="sip-remove" disabled={readOnly} onClick={() => setDeleteId(plan.id)}>Remove</button>
      </div>
      {showHistory && <div className="sip-history">
        <ul aria-label={`Instalments for ${mask(name)}`}>{[...plan.instalments!].reverse().map((item) => <li key={item.date}>
          <span>{shortDate(item.date)}</span>
          {item.status === 'skipped' ? <span className="sip-history-skipped">Skipped</span> : <>
            <span>{mask(money(item.amount))}</span>
            <span>NAV {mask(navMoney(item.imported?.nav ?? item.nav))}{item.navDate !== item.date && ` · ${shortDate(item.navDate)}`}</span>
            <strong title={item.imported ? `In your ${shortDate(item.imported.statementDate)} import${item.imported.units ? '; units match the import' : ''}` : 'Estimated: 0.005% stamp duty deducted, rounded to 3 decimals'}>+{mask(unitCount(item.imported?.units ?? item.units))}<span className="sip-history-source">{item.imported ? (item.imported.units ? ' matched' : ' in import') : ' est.'}</span></strong>
          </>}
        </li>)}</ul>
        <p>{recorded.length} recorded · {mask(money(recorded.reduce((total, item) => total + item.amount, 0)))} · {mask(`${unitCount(recorded.reduce((total, item) => total + item.units, 0))} units`)}{recorded.some((item) => !item.imported && item.added) && ` · ${recorded.filter((item) => !item.imported && item.added).length} added to holdings`}</p>
      </div>}
      {deleteId === plan.id && <div className="sip-delete" role="group" aria-label={`Remove tracking for ${mask(name)}`}><p>Remove tracking for <strong>{mask(name)}</strong>?</p><div className="sip-actions"><button type="button" onClick={() => { if (controller.deleteSipPlan(plan.id)) setMessage('SIP tracking removed.'); setDeleteId(null); setEditor(null); addButton.current?.focus() }}>Remove tracking</button><button type="button" data-sip-keep onClick={() => setDeleteId(null)}>Keep SIP</button></div></div>}
    </div>
  }

  const summary = hidden ? 'SIP details hidden.'
    : plans.length ? `${plans.length} SIP${plans.length === 1 ? '' : 's'} tracked${active.length < plans.length ? ` · ${plans.length - active.length} paused` : ''} · ${money(monthly)} / month`
    : schemes.length ? 'No SIPs tracked. Add one here.' : 'Confirm a scheme to track a SIP.'

  function openSchemeReview() {
    const schemesBox = content.current?.closest('.holdings-manage')?.querySelector<HTMLDetailsElement>('details.fund-review:not(.sip-schemes)')
    if (!schemesBox) return
    schemesBox.open = true
    schemesBox.scrollIntoView({ block: 'nearest' })
    schemesBox.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
  }

  return <>
    <FundSchemeReview />
    <details className="listing-review fund-review sip-schemes">
      <summary className="listing-review-trigger"><ActionIcon name="calendar" /><span className="listing-review-copy"><strong>Recurring SIPs</strong><span>{summary}</span></span><svg className="listing-review-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></summary>
      <div className="sip-content" ref={content}>
        {hidden ? <div className="sip-hidden"><ActionIcon name="privacy" /><p>Reveal portfolio values to manage SIP tracking.</p></div> : <>
          <div className="sip-section-head"><p>Your existing SIPs, tracked between imports.</p>{available.length > 0 && plans.length > 0 && <button ref={addButton} type="button" className="btn btn--primary" disabled={readOnly} onClick={() => openEditor()}>+ Add SIP</button>}</div>
          {plans.length === 0 && editor !== 'new' && (schemes.length
            ? <div className="sip-empty"><ActionIcon name="calendar" /><h4>Track your recurring SIP.</h4><p>Save the amount and date to start tracking.</p><button type="button" className="btn btn--secondary" disabled={readOnly} onClick={() => openEditor()}>Track your first SIP</button></div>
            : <div className="sip-empty"><ActionIcon name="review" /><h4>Confirm a scheme first.</h4><p>SIP tracking needs a confirmed fund, plan and option.</p><button type="button" className="btn btn--secondary" onClick={openSchemeReview}>Open Mutual-fund schemes</button></div>)}
          <div className="sip-in-place">{editor === 'new' && editorForm(false)}{plans.map((plan) => <div className="sip-inline-fund" key={plan.id}>{planRow(plan)}</div>)}</div>
          {message && <p className="sip-message" role="status">{message}</p>}
          <details className="sip-disclaimer" aria-labelledby={`${prefix}-disclaimer`}>
            <summary><ActionIcon name="warning" /><span id={`${prefix}-disclaimer`}>Disclaimer</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></summary>
            <p>Finverse tracks the schedule you enter; it does not place orders. Each instalment is estimated at the expected NAV date's published NAV, after 0.005% stamp duty, and listed beside the fund's imported entries. Add it to the holding with +; an import that covers that date replaces it. Actual allotment depends on the scheme, plan/option, fund receipt and cut-off time; your provider or AMC statement is final.</p>
          </details>
        </>}
      </div>
    </details>
  </>
}
