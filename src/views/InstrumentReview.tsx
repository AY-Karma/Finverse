import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useStore, type InstrumentCorrection } from '../useStore'
import { hasInrDenomination, isNumericBseScripCode, needsInstrumentReview } from '../instruments'
import type { Exchange, Position } from '../types'
import { ActionIcon } from './ActionIcon'
import { HiddenValuesState } from './HiddenValuesState'

const EXCHANGES: Exchange[] = ['NSE', 'BSE', 'OTHER']

function listing(position: Pick<Position, 'ticker' | 'type' | 'exchange' | 'currency' | 'providerSymbol'>): string {
  const provider = position.providerSymbol || (position.exchange === 'BSE' && isNumericBseScripCode(position.ticker) ? 'Provider symbol required' : 'Provider symbol derived from listing')
  return `${position.ticker || 'No symbol'} · ${position.type === 'etf' ? 'ETF' : position.type === 'stock' ? 'Stock' : 'Other'} · ${position.exchange ?? 'Unresolved venue'} · ${position.currency ?? 'Unresolved currency'} · ${provider}`
}

function defaultCorrection(position: Position): InstrumentCorrection {
  return { ticker: position.ticker, type: position.type, exchange: position.exchange ?? 'OTHER', currency: position.currency ?? 'INR', providerSymbol: position.providerSymbol ?? '', isin: position.isin ?? '', sector: position.sector ?? '' }
}

export function InstrumentReview({ onClose, autoFocus = true }: { onClose?: () => void; autoFocus?: boolean }) {
  const { positions, confirmInstrument, settings } = useStore()
  const holdings = positions.filter((position) => position.type !== 'mutual-fund')
    .sort((a, b) => Number(needsInstrumentReview(b)) - Number(needsInstrumentReview(a)))
  const pending = holdings.filter(needsInstrumentReview)
  const reviewCount = pending.length
  const reviewRef = useRef<HTMLElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<InstrumentCorrection | null>(null)
  const [saving, setSaving] = useState(false)
  const [approvingAll, setApprovingAll] = useState(false)
  const [error, setError] = useState('')
  const [bulkError, setBulkError] = useState('')
  const [message, setMessage] = useState('')
  const selected = holdings.find((position) => position.id === selectedId)
  const needsProviderSymbol = draft?.exchange === 'BSE' && isNumericBseScripCode(draft.ticker)

  useEffect(() => {
    const section = reviewRef.current
    if (!section || !onClose || !autoFocus) return
    section.focus({ preventScroll: true })
    section.scrollIntoView({ block: 'nearest' })
  }, [])

  function review(position: Position) {
    setSelectedId(position.id)
    setDraft(defaultCorrection(position))
    setError('')
    setBulkError('')
    setMessage('')
  }

  async function approveAll() {
    if (saving || !pending.length) return
    setSaving(true)
    setApprovingAll(true)
    setError('')
    setBulkError('')
    setMessage('')
    let approved = 0
    const failures: string[] = []
    try {
      for (const position of pending) {
        try {
          if (!hasInrDenomination(position)) throw new Error('Import a corrected INR statement before reviewing this listing.')
          await confirmInstrument(position.id, defaultCorrection(position))
          approved += 1
          if (position.id === selectedId) { setSelectedId(null); setDraft(null) }
        } catch (cause) {
          failures.push(`${position.name || position.ticker}: ${cause instanceof Error ? cause.message : 'The listing could not be saved.'}`)
        }
      }
      if (approved) setMessage(`${approved} default listing${approved === 1 ? '' : 's'} approved. Earlier tracked balances stay as recorded.`)
      if (failures.length) setBulkError(`${failures.length} listing${failures.length === 1 ? ' still needs' : 's still need'} review. ${failures.join(' ')}`)
    } finally { setSaving(false); setApprovingAll(false) }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!selected || !draft || saving) return
    setSaving(true)
    setError('')
    try {
      await confirmInstrument(selected.id, {
        ...draft, ticker: draft.ticker.trim(), providerSymbol: draft.providerSymbol?.trim() || undefined,
        isin: draft.isin?.trim() || undefined, sector: draft.sector?.trim() || undefined,
      })
      setSelectedId(null)
      setDraft(null)
      setMessage('Listing correction saved. Future prices and research use the reviewed listing; earlier tracked balances stay as recorded.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The listing correction could not be saved. Your edits are still here.')
    } finally { setSaving(false) }
  }

  if (!holdings.length) return null
  if (settings.hideValues) return <section id="instrument-review" ref={reviewRef} tabIndex={-1} aria-label="Review instrument listings" className="panel instrument-review fund-review">
    <div className="instrument-review-head">
      <h2>Review listings</h2>
      {onClose && <button className="icon-btn" type="button" aria-label="Close listing review" onClick={onClose}><ActionIcon name="close" /></button>}
    </div>
    <HiddenValuesState />
  </section>
  return <section id="instrument-review" ref={reviewRef} tabIndex={-1} aria-label="Review instrument listings" className={`panel instrument-review fund-review${reviewCount > 0 ? ' review-required' : ''}`}>
    <div className="instrument-review-head">
      <div><h2>Listing details</h2><span className="hint">{reviewCount > 0 ? `${reviewCount} listing${reviewCount === 1 ? ' needs' : 's need'} confirmation` : 'No listings need review'}</span></div>
      {onClose && <button className="icon-btn" type="button" aria-label="Close listing review" onClick={onClose}><ActionIcon name="close" /></button>}
    </div>
    <div className="instrument-review-scroll" role="region" aria-label="Instrument listings" tabIndex={0}>
      <p className="hint">Use the original broker statement to confirm each listing. Unresolved instruments retain imported values until corrected. This review sends no external requests.</p>
      {reviewCount > 0 && <div className="import-actions">
        <button type="button" className="btn btn--primary btn--small" disabled={saving} onClick={() => void approveAll()}>{approvingAll ? 'Approving default listings…' : 'Approve all default listings'}</button>
        <span className="hint">Use the current values shown below. Listings with invalid details will still need review.</span>
      </div>}
      {bulkError && <p className="hint down" role="alert">{bulkError}</p>}
      {message && <p className="hint" role="status">{message}</p>}
      {holdings.map((position) => <div key={position.id} className="instrument-review-item">
        <div className="folio-row">
          <div className="folio-copy" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <div className="listing-item-title"><span className="sym">{position.name || position.ticker}</span><span className={`listing-item-status${needsInstrumentReview(position) ? ' listing-item-status--pending' : ''}`}>{needsInstrumentReview(position) ? 'Needs review' : 'Ready'}</span></div>
            <dl className="listing-facts">
              <div><dt>Symbol</dt><dd>{position.ticker || 'Not provided'}</dd></div>
              <div><dt>Exchange</dt><dd>{position.exchange ?? 'Unresolved'}{position.exchangeSource !== 'explicit' && ' (inferred)'}</dd></div>
              <div><dt>Currency</dt><dd>{position.currency ?? 'Unresolved'}</dd></div>
              <div><dt>Price symbol</dt><dd>{position.providerSymbol || 'Derived from listing'}</dd></div>
            </dl>
            {position.identityIssue && <span className="hint down">{position.identityIssue}</span>}
            {(position.reportedExchange || position.reportedCurrency) && <span className="hint">Statement metadata: {position.reportedExchange ? `exchange ${position.reportedExchange}` : ''}{position.reportedExchange && position.reportedCurrency ? ', ' : ''}{position.reportedCurrency ? `currency ${position.reportedCurrency}` : ''}</span>}
            {!hasInrDenomination(position) && <span className="hint">Import a corrected INR statement to review this listing. Original unsupported amounts are retained.</span>}
          </div>
          <button type="button" className="btn btn--secondary btn--small" disabled={saving || !hasInrDenomination(position)} aria-expanded={selectedId === position.id} onClick={() => review(position)}>Review listing</button>
        </div>
        {selected?.id === position.id && draft && hasInrDenomination(selected) && <form className="import-preview" aria-label="Review instrument listing" onSubmit={(event) => void save(event)}>
          <strong style={{ overflowWrap: 'anywhere' }}>{selected.name || selected.ticker}</strong>
          <p className="hint" style={{ overflowWrap: 'anywhere' }}>Current listing: {listing(selected)}</p>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
            <label className="statement-field">Symbol<input className="input" required maxLength={100} value={draft.ticker} onChange={(event) => setDraft({ ...draft, ticker: event.target.value, providerSymbol: '' })} /></label>
            <label className="statement-field">Asset type<select className="select" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as InstrumentCorrection['type'] })}><option value="stock">Stock</option><option value="etf">ETF</option><option value="other">Other</option></select></label>
            <label className="statement-field">Exchange<select className="select" value={draft.exchange} onChange={(event) => setDraft({ ...draft, exchange: event.target.value as Exchange, providerSymbol: '' })}>{EXCHANGES.map((exchange) => <option key={exchange} value={exchange}>{exchange === 'OTHER' ? 'Other / unresolved' : exchange}</option>)}</select></label>
            <label className="statement-field">{`Provider symbol, ${needsProviderSymbol ? 'required' : 'optional'}`}<input className="input" required={needsProviderSymbol} maxLength={100} value={draft.providerSymbol ?? ''} placeholder={needsProviderSymbol ? 'Enter the matching BSE provider symbol' : 'Leave blank to derive from the listing'} onChange={(event) => setDraft({ ...draft, providerSymbol: event.target.value })} /></label>
            <label className="statement-field">ISIN, optional<input className="input" maxLength={12} value={draft.isin ?? ''} onChange={(event) => setDraft({ ...draft, isin: event.target.value })} /></label>
            <label className="statement-field">Sector, optional<input className="input" maxLength={100} value={draft.sector ?? ''} onChange={(event) => setDraft({ ...draft, sector: event.target.value })} /></label>
          </div>
          <p className="hint" style={{ overflowWrap: 'anywhere' }}>Reviewed listing: {listing(draft)}</p>
          <p className="hint">{needsProviderSymbol ? 'Numeric BSE codes need a confirmed provider symbol ending in .BO. Keep the BSE venue; imported values stay in use until corrected.' : 'Confirm the symbol and exchange with your INR statement. Changing either clears the old provider symbol.'}</p>
          <div className="import-actions"><button type="submit" className="btn btn--primary" disabled={saving || !draft.ticker.trim()}>{saving && !approvingAll ? 'Saving correction…' : 'Save listing correction'}</button><button type="button" className="btn btn--ghost" disabled={saving} onClick={() => { setSelectedId(null); setDraft(null); setError('') }}>Cancel listing review</button></div>
          {error && <p className="hint down" role="alert">{error}</p>}
        </form>}
      </div>)}
    </div>
  </section>
}
