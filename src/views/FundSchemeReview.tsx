import { useEffect, useRef, useState } from 'react'
import { useStore } from '../useStore'
import { marketData } from '../marketData'
import { canConfirmFundScheme, matchFundScheme, type FundSchemeReview as SchemeReview } from '../fundSchemes'
import { hasSupportedValuationCurrency } from '../valuation'
import type { Position } from '../types'
import { HiddenValuesState } from './HiddenValuesState'
import { ActionIcon } from './ActionIcon'

function supportsFundNav(fund: Position): boolean {
  return hasSupportedValuationCurrency({ ...fund, currency: fund.currency ?? 'INR' })
}

export function FundSchemeReview() {
  const { positions, settings, confirmFundScheme } = useStore()
  const funds = positions.filter((position) => position.type === 'mutual-fund')
  const reviewCount = funds.filter((fund) => !fund.mfScheme).length
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [review, setReview] = useState<SchemeReview | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [approvingAll, setApprovingAll] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [message, setMessage] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const selected = funds.find((fund) => fund.id === selectedId)

  useEffect(() => {
    if (!settings?.allowExternalData || settings.hideValues) {
      controllerRef.current?.abort()
      setBusy(false)
      setApprovingAll(false)
      setSelectedId(null)
      setReview(null)
      setCode('')
      setMessage('')
    }
    return () => controllerRef.current?.abort()
  }, [settings?.allowExternalData, settings?.hideValues])

  async function approveAll() {
    if (busy || settings.hideValues || !settings.allowExternalData) return
    const pending = funds.filter((fund) => !fund.mfScheme && supportsFundNav(fund))
    if (!pending.length) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setApprovingAll(true)
    setSelectedId(null)
    setReview(null)
    setCode('')
    setMessage('')
    let approved = 0
    let failed = 0
    let remaining = 0
    try {
      for (const fund of pending) {
        if (controller.signal.aborted) return
        try {
          const result = await marketData.reviewFundScheme(fund.name || fund.ticker, controller.signal)
          if (controller.signal.aborted) return
          const current = positionsRef.current.find((position) => position.id === fund.id)
          if (!current || current.type !== 'mutual-fund' || current.mfScheme) continue
          const match = matchFundScheme(current.name || current.ticker, result.candidates).match
          if (result.status === 'unavailable' || !match || !supportsFundNav(current)) {
            remaining += 1
            continue
          }
          await confirmFundScheme(current.id, match)
          approved += 1
        } catch {
          if (controller.signal.aborted) return
          failed += 1
        }
      }
      if (!controller.signal.aborted) setMessage([
        `${approved} scheme${approved === 1 ? '' : 's'} approved.`,
        remaining ? `${remaining} need manual review.` : '',
        failed ? `${failed} could not be approved. Try again.` : '',
      ].filter(Boolean).join(' '))
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false)
        setApprovingAll(false)
      }
    }
  }

  async function findScheme(id: string) {
    const fund = funds.find((position) => position.id === id)
    if (!fund || busy || settings.hideValues || !settings.allowExternalData || !supportsFundNav(fund)) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setSelectedId(id)
    setReview(null)
    setMessage('')
    setCode('')
    setBusy(true)
    try {
      const result = await marketData.reviewFundScheme(fund.name || fund.ticker, controller.signal)
      if (controller.signal.aborted) return
      setReview(result)
      if (result.match) setCode(String(result.match.schemeCode))
    } catch (cause) {
      if (!controller.signal.aborted) setMessage(cause instanceof Error ? cause.message : 'The scheme search is unavailable. Imported values are retained.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  async function confirm() {
    const candidate = review?.candidates.find((item) => String(item.schemeCode) === code)
    if (!selected || !candidate || busy || settings.hideValues || !settings.allowExternalData || !supportsFundNav(selected)
      || !canConfirmFundScheme(selected.name || selected.ticker, candidate)) return
    setBusy(true)
    setMessage('')
    try {
      await confirmFundScheme(selected.id, candidate)
      setSelectedId(null)
      setReview(null)
      setMessage('Scheme saved. NAV and history will use this scheme. Earlier tracked balances remain as recorded.')
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The scheme could not be saved.')
    } finally { setBusy(false) }
  }

  if (!funds.length) return null
  if (settings.hideValues) return <section className="workspace-recovery fund-review" aria-label="Review mutual-fund schemes"><HiddenValuesState /></section>
  const candidate = review?.candidates.find((item) => String(item.schemeCode) === code)
  return <details className={`listing-review fund-review${reviewCount > 0 ? ' listing-review--pending' : ''}`} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary className="listing-review-trigger">
      <ActionIcon name="review" />
      <span className="listing-review-copy"><strong>Mutual-fund schemes</strong><span>{reviewCount > 0 ? `${reviewCount} scheme${reviewCount === 1 ? ' needs' : 's need'} your confirmation.` : 'No schemes need review. View or edit them here.'}</span></span>
      <span className="listing-review-action">{expanded ? 'Close schemes' : reviewCount > 0 ? 'Review schemes' : 'View schemes'}</span>
      <svg className="listing-review-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </summary>
    <div className="fund-scheme-content">
    <p className="hint">Unconfirmed funds keep their imported values. Confirm the fund, Direct or Regular plan, and Growth or IDCW option before fetching NAV or history.</p>
    {!settings.allowExternalData && <p className="hint">Enable external market data in Settings to search scheme names. No search is sent while it is off.</p>}
    <div className="import-actions">
      <button type="button" className="btn btn--primary btn--small" disabled={busy || !settings.allowExternalData || !funds.some((fund) => !fund.mfScheme && supportsFundNav(fund))} onClick={() => void approveAll()}>{approvingAll ? 'Approving schemes…' : 'Auto-approve schemes'}</button>
      <span className="hint">Exact fund, plan and option matches only.</span>
    </div>
    {funds.map((fund) => <div className="fund-scheme-row" key={fund.id}>
      <div className="folio-copy"><span className="sym">{fund.name || fund.ticker}</span><span className="hint">{fund.mfScheme ? `${fund.mfScheme.name} · code ${fund.mfScheme.code}` : 'Imported values · scheme unconfirmed'}</span>{!supportsFundNav(fund) && <span className="hint">MFAPI supports INR mutual funds only. This holding's {fund.reportedCurrency || fund.currency} currency cannot use its scheme search or confirmation.</span>}</div>
      <button type="button" className="btn btn--secondary btn--small" disabled={busy || !settings.allowExternalData || !supportsFundNav(fund)} onClick={() => void findScheme(fund.id)}>{fund.mfScheme ? 'Review scheme' : 'Find scheme'}</button>
    </div>)}
    {selected && supportsFundNav(selected) && <section className="import-preview" aria-label="Review fund scheme">
      <strong>{selected.name}</strong>
      {busy && !review ? <p role="status" className="hint">Searching schemes…</p> : review && <>
        <p className="hint">{review.reason}</p>
        {review.candidates.length > 0 && <label className="statement-field">Provider scheme
          <select className="select" value={code} onChange={(event) => setCode(event.target.value)}>
            <option value="">Choose the exact plan and option</option>
            {review.candidates.map((item) => <option key={item.schemeCode} value={item.schemeCode} disabled={!canConfirmFundScheme(selected.name || selected.ticker, item)}>{item.schemeName} · {item.schemeCode}</option>)}
          </select>
        </label>}
        <p className="hint">A correction changes future prices and history. It cannot reconstruct earlier balances that used uncertain mappings.</p>
        <div className="import-actions"><button type="button" className="btn btn--primary" disabled={busy || !settings.allowExternalData || !candidate || !canConfirmFundScheme(selected.name || selected.ticker, candidate)} onClick={() => void confirm()}>Confirm scheme</button><button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { setSelectedId(null); setReview(null) }}>Cancel scheme review</button></div>
      </>}
    </section>}
    {message && <p className="hint" role="status">{message}</p>}
    </div>
  </details>
}
