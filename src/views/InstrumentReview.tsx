import { useState, type FormEvent } from 'react'
import { useStore, type InstrumentCorrection } from '../useStore'
import type { Currency, Exchange, Position } from '../types'

const EXCHANGES: Exchange[] = ['NSE', 'BSE', 'NASDAQ', 'NYSE', 'LSE', 'OTHER']

function listing(position: Pick<Position, 'ticker' | 'type' | 'exchange' | 'currency' | 'providerSymbol'>): string {
  return `${position.ticker || 'No symbol'} · ${position.type === 'etf' ? 'ETF' : position.type === 'stock' ? 'Stock' : 'Other'} · ${position.exchange ?? 'Unresolved venue'} · ${position.currency ?? 'Unresolved currency'} · ${position.providerSymbol || 'Provider symbol derived from listing'}`
}

export function InstrumentReview() {
  const { positions, confirmInstrument } = useStore()
  const holdings = positions.filter((position) => position.type !== 'mutual-fund')
  const reviewCount = holdings.filter((position) => position.identityIssue || position.exchangeSource !== 'explicit').length
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<InstrumentCorrection | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const selected = holdings.find((position) => position.id === selectedId)

  function review(position: Position) {
    setSelectedId(position.id)
    setDraft({ ticker: position.ticker, type: position.type, exchange: position.exchange ?? 'OTHER', currency: position.currency ?? 'INR', providerSymbol: position.providerSymbol ?? '', isin: position.isin ?? '', sector: position.sector ?? '' })
    setError('')
    setMessage('')
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
  return <details className="workspace-recovery instrument-review fund-review">
    <summary>Review instrument listings · {reviewCount} inferred or unresolved</summary>
    <p className="hint">Use the original broker statement to confirm each listing. Unresolved instruments retain imported values until corrected. This review sends no external requests.</p>
    {holdings.map((position) => <div className="folio-row" key={position.id}>
      <div className="folio-copy" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <span className="sym">{position.name || position.ticker}</span>
        <span className="hint">{listing(position)}</span>
        <span className="hint">{position.exchangeSource === 'explicit' ? 'Explicit exchange' : 'Inferred exchange, confirm with your statement'}</span>
        {position.identityIssue && <span className="hint down">{position.identityIssue}</span>}
        {(position.reportedExchange || position.reportedCurrency) && <span className="hint">Statement metadata: {position.reportedExchange ? `exchange ${position.reportedExchange}` : ''}{position.reportedExchange && position.reportedCurrency ? ', ' : ''}{position.reportedCurrency ? `currency ${position.reportedCurrency}` : ''}</span>}
      </div>
      <button type="button" className="btn btn--secondary btn--small" disabled={saving} onClick={() => review(position)}>Review listing</button>
    </div>)}
    {selected && draft && <form className="import-preview" aria-label="Review instrument listing" onSubmit={(event) => void save(event)}>
      <strong style={{ overflowWrap: 'anywhere' }}>{selected.name || selected.ticker}</strong>
      <p className="hint" style={{ overflowWrap: 'anywhere' }}>Current listing: {listing(selected)}</p>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
        <label className="statement-field">Symbol<input className="input" required maxLength={100} value={draft.ticker} onChange={(event) => setDraft({ ...draft, ticker: event.target.value, providerSymbol: '' })} /></label>
        <label className="statement-field">Asset type<select className="select" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as InstrumentCorrection['type'] })}><option value="stock">Stock</option><option value="etf">ETF</option><option value="other">Other</option></select></label>
        <label className="statement-field">Exchange<select className="select" value={draft.exchange} onChange={(event) => setDraft({ ...draft, exchange: event.target.value as Exchange, providerSymbol: '' })}>{EXCHANGES.map((exchange) => <option key={exchange} value={exchange}>{exchange === 'OTHER' ? 'Other / unresolved' : exchange}</option>)}</select></label>
        <label className="statement-field">Asset currency<select className="select" value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as Currency })}><option value="INR">INR</option><option value="USD">USD</option></select></label>
        <label className="statement-field">Provider symbol, optional<input className="input" maxLength={100} value={draft.providerSymbol ?? ''} placeholder="Leave blank to derive from the listing" onChange={(event) => setDraft({ ...draft, providerSymbol: event.target.value })} /></label>
        <label className="statement-field">ISIN, optional<input className="input" maxLength={12} value={draft.isin ?? ''} onChange={(event) => setDraft({ ...draft, isin: event.target.value })} /></label>
        <label className="statement-field">Sector, optional<input className="input" maxLength={100} value={draft.sector ?? ''} onChange={(event) => setDraft({ ...draft, sector: event.target.value })} /></label>
      </div>
      <p className="hint" style={{ overflowWrap: 'anywhere' }}>Reviewed listing: {listing(draft)}</p>
      <p className="hint">Confirm that the symbol, exchange and currency match your statement. Changing the symbol or exchange clears the old provider symbol so it can be derived again.</p>
      <div className="import-actions"><button type="submit" className="btn btn--primary" disabled={saving || !draft.ticker.trim()}>{saving ? 'Saving correction…' : 'Save listing correction'}</button><button type="button" className="btn btn--ghost" disabled={saving} onClick={() => { setSelectedId(null); setDraft(null); setError('') }}>Cancel listing review</button></div>
      {error && <p className="hint down" role="alert">{error}</p>}
    </form>}
    {message && <p className="hint" role="status">{message}</p>}
  </details>
}
