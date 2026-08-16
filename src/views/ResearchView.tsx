import { useMemo } from 'react'
import { instrumentLabel } from '../instruments'
import { marketLinks, researchSource } from '../research'
import { useStore } from '../useStore'
import { formatCurrency, positionValue } from '../valuation'

export function ResearchView({ onOpenAssistant }: { onOpenAssistant: () => void }) {
  const { positions, liveQuotes, fxRate, settings, snapshot } = useStore()
  const currency = settings.currency || 'INR'
  const rows = useMemo(() => positions.map((position) => ({
    position,
    value: positionValue(position, liveQuotes),
  })).sort((a, b) => b.value - a.value), [positions, liveQuotes])
  const aiConfigured = settings.provider === 'ollama' || Boolean(settings.provider && settings.apiKey)

  return <>
    <div className="page-head enter d0"><div><div className="page-eyebrow">04 · Research</div><h1 className="page-title">Research your exposure</h1></div><p className="page-sub">Open clearly labeled third-party sources for holdings already in your portfolio. Finverse does not present these links as fetched news.</p></div>
    <section className="panel research-brief enter d1"><div><span className="score-label">Portfolio context</span><strong>{positions.length} holding{positions.length === 1 ? '' : 's'} · {snapshot.sectors.length} allocation group{snapshot.sectors.length === 1 ? '' : 's'}</strong><span className="hint">Links open external websites in a new tab. Your quantities and cost basis are not added to those URLs.</span></div><div><button type="button" className="btn btn--primary" onClick={onOpenAssistant}>Ask AI about this portfolio</button><span className="hint">{aiConfigured ? 'Uses your configured provider and consent settings.' : 'Provider setup is required before anything is sent.'}</span></div></section>
    {rows.length === 0 ? <section className="panel research-empty enter d2"><strong>Research starts with your holdings</strong><p className="hint">Import a portfolio from Holdings to build a private, portfolio-derived research list.</p></section> : <section className="research-grid enter d2" aria-label="Portfolio research links">{rows.map(({ position, value }) => <article className="panel research-card" key={position.id}><div className="research-card-head"><div><span className="sym">{instrumentLabel(position)}</span><span className="holdings-name">{position.name || position.sector || 'Imported holding'}</span></div><span className="section-index">{formatCurrency(value, currency, fxRate?.usdInr)}</span></div><div className="research-links">{marketLinks(position).map((link) => <a key={link.url} className="btn btn--secondary btn--small" href={link.url} target="_blank" rel="noreferrer"><span>{link.label}</span><small>{researchSource(link.url)} · external</small></a>)}</div></article>)}</section>}
  </>
}
