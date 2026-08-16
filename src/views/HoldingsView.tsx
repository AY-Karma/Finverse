import { useMemo, useState } from 'react'
import { assetTypeLabel, instrumentLabel } from '../instruments'
import { privateValue, visibleQuotes } from '../privacy'
import { useStore } from '../useStore'
import { computePortfolioStats, effectivePrice, formatCurrency, positionPnl, positionValue } from '../valuation'
import { ImportView } from './ImportView'

export function HoldingsView() {
  const { folios, positions, liveQuotes, fxRate, settings, removeFolio, undoLastImport, exportPortfolio } = useStore()
  const [query, setQuery] = useState('')
  const [importOpen, setImportOpen] = useState(folios.length === 0)
  const currency = settings.currency || 'INR'
  const rate = fxRate?.usdInr
  const quotes = useMemo(
    () => visibleQuotes(settings.allowExternalData, liveQuotes),
    [settings.allowExternalData, liveQuotes],
  )
  const stats = useMemo(() => computePortfolioStats(positions, quotes), [positions, quotes])
  const display = (value: string) => privateValue(value, settings.hideValues)
  const rows = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    if (!term) return positions
    return positions.filter((position) => [position.ticker, position.name, position.sector, position.category, position.folio]
      .some((value) => value?.toLocaleLowerCase().includes(term)))
  }, [positions, query])

  return <>
    <div className="page-head enter d0">
      <div><div className="page-eyebrow">02 · Holdings</div><h1 className="page-title">Your holdings workspace</h1></div>
      <p className="page-sub">Review what you own, manage source folios, and import or export without leaving the ledger.</p>
    </div>

    <div className="holdings-summary enter d1" aria-label="Portfolio summary">
      <Summary label="Portfolio value" value={display(formatCurrency(stats.currentValue, currency, rate))} />
      <Summary label="Invested" value={display(formatCurrency(stats.invested, currency, rate))} />
      <Summary label="Total P&L" value={display(formatCurrency(stats.pnl, currency, rate))} tone={settings.hideValues ? undefined : stats.pnl < 0 ? 'down' : 'up'} />
      <Summary label="Sources" value={`${folios.length} folio${folios.length === 1 ? '' : 's'}`} />
    </div>

    <div className="panel holdings-toolbar enter d2">
      <label className="field holdings-search"><span className="sr-only">Search holdings</span><input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol, name, sector, or folio" /></label>
      <div className="import-actions">
        <button className="btn btn--primary btn--small" type="button" aria-expanded={importOpen} onClick={() => setImportOpen((open) => !open)}>Import holdings</button>
        <button className="btn btn--secondary btn--small" type="button" disabled={!positions.length} onClick={() => exportPortfolio('csv')}>Export CSV</button>
        <button className="btn btn--secondary btn--small" type="button" disabled={!positions.length} onClick={() => exportPortfolio('json')}>Backup JSON</button>
        <button className="btn btn--ghost btn--small" type="button" onClick={undoLastImport}>Undo import</button>
      </div>
    </div>

    {importOpen && <section className="panel holdings-import enter" aria-label="Import holdings"><div className="panel-head"><span className="panel-title">Import a spreadsheet</span><span className="section-index">Preview before saving</span></div><ImportView compact /></section>}

    <div className="holdings-layout enter d3">
      <section className="panel holdings-ledger">
        <div className="panel-head"><span className="panel-title">Holdings</span><span className="section-index">{rows.length} of {positions.length}</span></div>
        {positions.length === 0 ? <div className="holdings-empty"><strong>No holdings loaded</strong><span className="hint">Import an .xlsx, .xls, or .csv file to create your first folio.</span></div> : rows.length === 0 ? <div className="holdings-empty"><strong>No matching holdings</strong><span className="hint">Try a symbol, company, sector, or folio name.</span></div> : <div className="table-scroll"><table className="table table--ledger"><thead><tr><th>Holding</th><th>Type</th><th className="num">Quantity</th><th className="num">Price</th><th className="num">Value</th><th className="num">P&L</th></tr></thead><tbody>{rows.map((position) => {
          const pnl = positionPnl(position, quotes)
          return <tr key={position.id}><td><span className="sym">{instrumentLabel(position)}</span><span className="holdings-name">{position.name || position.sector || 'Imported holding'}</span></td><td className="muted">{assetTypeLabel(position.type)}</td><td className="num">{display(position.quantity.toLocaleString())}</td><td className="num">{display(formatCurrency(effectivePrice(position, quotes) ?? 0, currency, rate))}</td><td className="num">{display(formatCurrency(positionValue(position, quotes), currency, rate))}</td><td className={`num ${!settings.hideValues && pnl != null && pnl < 0 ? 'down' : !settings.hideValues ? 'up' : ''}`}>{display(pnl == null ? '—' : formatCurrency(pnl, currency, rate))}</td></tr>
        })}</tbody></table></div>}
      </section>

      <aside className="panel folio-panel" aria-label="Portfolio folios"><div className="panel-head"><span className="panel-title">Folios</span><span className="section-index">Local sources</span></div>{folios.length === 0 ? <p className="hint">Each accepted import appears here as a removable local folio.</p> : folios.map((folio) => <div className="folio-row" key={folio.id}><div className="folio-marker" /><div className="folio-copy"><span className="sym">{folio.name}</span><span className="hint">{folio.positions.length} holding{folio.positions.length === 1 ? '' : 's'} · {new Date(folio.importedAt).toLocaleDateString()}</span></div><button className="btn-remove" type="button" aria-label={`Remove ${folio.name}`} onClick={() => removeFolio(folio.id)}>×</button></div>)}</aside>
    </div>
  </>
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return <div className="panel holdings-stat"><span className="score-label">{label}</span><strong className={tone}>{value}</strong></div>
}
