import { useEffect, useMemo, useRef, useState } from 'react'
import type { Position } from '../types'
import type { View } from '../useStore'
import { useStore } from '../useStore'
import { assetTypeLabel, instrumentLabel } from '../instruments'
import { marketLinks, researchSource, resolveScreenerCompanyPath, reviewQuestions, supportsCompanyResearch, type ResearchLink } from '../research'
import { monogramTile } from '../logos'
import { privateValue, visibleQuotes } from '../privacy'
import { effectivePrice, formatCurrency, formatPercent, positionPnl, positionPnlPct, positionValue, quoteKey } from '../valuation'
import { PortfolioRequiredState } from './PortfolioRequiredState'
import { ResearchHistory } from './ResearchHistory'
import { ResearchSourceIcon } from './ResearchSourceIcon'
import { useResearchNavigation, type ResearchTab } from './useResearchNavigation'
import './research.css'

const PAGE_SIZE = 24
const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function groupLabel(position: Position): string {
  return position.type === 'mutual-fund' ? position.category || 'Uncategorized funds' : position.sector || 'Uncategorized holdings'
}

export function ResearchView({ onRequestImport, onGoTo, active = true, onUrlChange }: {
  onRequestImport: () => void;
  onGoTo?: (view: View, position?: Position) => void; active?: boolean; onUrlChange?: (url: string) => void
}) {
  const { positions, liveQuotes, fxRate, settings } = useStore()
  const { navigation, updateNavigation, returnToHoldings } = useResearchNavigation(active, onUrlChange)
  const [paths, setPaths] = useState<Record<string, string | null>>({})
  const headingRef = useRef<HTMLHeadingElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const previousHolding = useRef(navigation.holding)
  const listScroll = useRef(0)
  const quotes = useMemo(() => visibleQuotes(settings.allowExternalData, liveQuotes), [settings.allowExternalData, liveQuotes])
  const rows = useMemo(() => positions.map((position) => ({ position, value: effectivePrice(position, quotes) == null ? null : positionValue(position, quotes) })), [positions, quotes])
  const groups = useMemo(() => [...new Set(positions.map(groupLabel))].sort(), [positions])
  const singleCurrency = new Set(positions.map((position) => position.currency || 'INR')).size === 1
  const filtered = useMemo(() => {
    const query = navigation.query.trim().toLowerCase()
    return rows.filter(({ position }) => (!query || `${position.name} ${position.ticker} ${position.isin || ''} ${groupLabel(position)}`.toLowerCase().includes(query)) && (navigation.asset === 'all' || position.type === navigation.asset) && (navigation.group === 'all' || groupLabel(position) === navigation.group))
      .sort((a, b) => navigation.sort === 'value' && singleCurrency ? (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.position.name.localeCompare(b.position.name) : (a.position.name || a.position.ticker).localeCompare(b.position.name || b.position.ticker))
  }, [rows, navigation.query, navigation.asset, navigation.group, navigation.sort, singleCurrency])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(Math.floor(navigation.page), pageCount - 1)
  const visibleRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const selected = navigation.holding ? positions.find((position) => position.id === navigation.holding) : visibleRows[0]?.position
  const key = selected ? JSON.stringify([selected.id, selected.type, selected.ticker, selected.exchange, selected.isin]) : ''
  const pricedCount = rows.filter((row) => row.value != null).length
  const totalValue = rows.reduce((total, row) => total + (row.value || 0), 0)
  const value = selected && effectivePrice(selected, quotes) != null ? positionValue(selected, quotes) : null
  const pnl = selected ? positionPnl(selected, quotes) : null
  const pnlPct = selected ? positionPnlPct(selected, quotes) : null
  const weight = singleCurrency && pricedCount === positions.length && totalValue > 0 && value != null ? value / totalValue * 100 : null

  useEffect(() => {
    if (!active || !settings.allowExternalData || !selected || !supportsCompanyResearch(selected)) return
    const controller = new AbortController()
    void resolveScreenerCompanyPath(selected.ticker, controller.signal).then((path) => {
      if (!controller.signal.aborted) setPaths((previous) => ({ ...previous, [key]: path }))
    }).catch(() => { /* A labeled source search remains available. */ })
    return () => controller.abort()
  }, [active, selected?.ticker, key, settings.allowExternalData])

  useEffect(() => {
    if (!active) return
    if (navigation.holding) {
      headingRef.current?.focus({ preventScroll: true })
      if (window.matchMedia?.('(max-width: 1050px)').matches) window.scrollTo(0, 0)
    } else if (previousHolding.current) {
      const row = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-holding-id]') || [])].find((button) => button.dataset.holdingId === previousHolding.current)
      row?.focus({ preventScroll: true })
      if (window.matchMedia?.('(max-width: 1050px)').matches) window.scrollTo(0, listScroll.current)
    }
    previousHolding.current = navigation.holding
  }, [navigation.holding, active])

  function openHolding(position: Position | null) {
    if (!position) { returnToHoldings(); return }
    if (!navigation.holding) listScroll.current = window.scrollY
    updateNavigation({ holding: position.id, tab: 'overview' }, !navigation.holding)
  }

  if (!positions.length) return <PortfolioRequiredState area="04 · Research" description="Bring in your holdings to explore sources for every investment." onImport={onRequestImport} />

  const hasFx = fxRate?.usdInr != null && Number.isFinite(fxRate.usdInr) && fxRate.usdInr > 0
  const displayCurrency = settings.currency === 'USD' && hasFx ? 'USD' : 'INR'
  const formatAmount = (amount: number) => selected?.currency === 'USD'
    ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount)
    : formatCurrency(amount, displayCurrency, fxRate?.usdInr)
  const amount = (number: number | null, fallback = 'Unavailable') => privateValue(number == null ? fallback : formatAmount(number), settings.hideValues)
  const quote = selected ? quotes[quoteKey(selected)] : undefined
  const validQuote = quote && Number.isFinite(quote.price) && quote.price >= 0
  const basis = value == null ? 'Price unavailable' : validQuote
    ? `${quote.source === 'nav' ? 'Daily NAV' : quote.source === 'nse-close' ? 'NSE close' : 'Yahoo quote'} · ${Number.isFinite(quote.at) ? DATE_FORMAT.format(quote.at) : 'Date unknown'}`
    : 'Imported price · Date unknown'
  const links = selected ? marketLinks(selected, settings.allowExternalData ? paths[key] : null) : []
  const questions = selected ? reviewQuestions(selected.type) : []
  const tabs: { id: ResearchTab; label: string }[] = [{ id: 'overview', label: 'Overview' }, { id: 'sources', label: 'Sources' }]

  return <div className={`research-desk${navigation.holding ? ' rd-has-selection' : ''}`}>
    <header className="rd-page-head"><div><div className="page-eyebrow">04 · Research</div><h1 className="page-title">Research desk</h1><p>Know what you own. Follow the evidence.</p></div></header>
    <div className="rd-context"><span>{positions.length} investments</span><span>{pricedCount}/{positions.length} priced</span><span><i className={`rd-status-dot${settings.allowExternalData ? ' is-on' : ''}`} />External data {settings.allowExternalData ? 'on' : 'off'}</span><span className="rd-context-end">Research starts with your holdings</span></div>
    <div className="rd-toolbar" role="search" aria-label="Find an investment">
      <label className="rd-search"><SearchIcon /><input type="search" value={navigation.query} maxLength={200} placeholder="Find a holding..." aria-label="Search research holdings" onChange={(event) => updateNavigation({ query: event.target.value, page: 0, holding: '', tab: 'overview' })} /></label>
      <label className="rd-filter"><span>Asset</span><select aria-label="Filter by asset type" value={navigation.asset} onChange={(event) => updateNavigation({ asset: event.target.value, group: 'all', page: 0, holding: '', tab: 'overview' })}><option value="all">All assets</option>{(['stock', 'mutual-fund', 'etf', 'other'] as const).map((type) => <option value={type} key={type}>{assetTypeLabel(type)}</option>)}</select></label>
      <label className="rd-filter"><span>Group</span><select aria-label="Filter by sector or category" value={navigation.group} onChange={(event) => updateNavigation({ group: event.target.value, page: 0, holding: '', tab: 'overview' })}><option value="all">All groups</option>{groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>
      <label className="rd-filter"><span>Sort</span><select aria-label="Sort research holdings" value={navigation.sort} onChange={(event) => updateNavigation({ sort: event.target.value === 'value' ? 'value' : 'name', page: 0 })}><option value="name">Name</option>{singleCurrency && <option value="value">Holding value</option>}</select></label>
    </div>
    <div className="rd-workspace">
      <aside className="rd-list-panel" aria-label="Research holdings">
        <div className="rd-list-head"><strong>Your investments</strong><span>{visibleRows.length} of {filtered.length} shown</span></div>
        <div className="rd-holding-list" ref={listRef}>
          {visibleRows.map(({ position }) => <button type="button" className="rd-holding" key={position.id} data-holding-id={position.id} aria-current={selected?.id === position.id ? 'true' : undefined} onClick={() => openHolding(position)}>
            <Avatar position={position} mode={settings.mode} /><span className="rd-holding-copy"><strong>{position.name || position.ticker}</strong><span>{position.type === 'mutual-fund' ? position.category || 'Mutual fund' : `${instrumentLabel(position)} · ${position.exchange || 'NSE'} · ${assetTypeLabel(position.type)}`}</span></span><span className="rd-row-arrow" aria-hidden="true">›</span>
          </button>)}
          {!visibleRows.length && <div className="rd-list-empty"><strong>No matching investments</strong><p>Try another name or clear the filters.</p><button type="button" className="btn btn--secondary" onClick={() => updateNavigation({ query: '', asset: 'all', group: 'all', page: 0 })}>Clear filters</button></div>}
        </div>
        {pageCount > 1 && <nav className="rd-pagination" aria-label="Research pages"><button type="button" disabled={page === 0} onClick={() => updateNavigation({ page: page - 1 })}>Previous</button><span>Page {page + 1} of {pageCount}</span><button type="button" disabled={page === pageCount - 1} onClick={() => updateNavigation({ page: page + 1 })}>Next</button></nav>}
        <p className="rd-list-foot">Research guidance, not a buy or sell signal.</p>
      </aside>
      <article className="rd-dossier" aria-label="Selected investment dossier">
        <button className="rd-back" type="button" onClick={() => openHolding(null)}>← All holdings</button>
        {!selected ? <div className="rd-detail-empty"><SearchIcon /><h2>{navigation.holding ? 'Holding no longer available' : 'Choose an investment'}</h2><p>{navigation.holding ? 'The holding may have been removed. Choose another investment from your holdings.' : 'Open a holding to explore its sources and review your investment.'}</p>{navigation.holding && <button type="button" className="btn btn--secondary" onClick={() => openHolding(null)}>Return to holdings</button>}</div> : <>
          <header className="rd-dossier-head"><Avatar position={selected} mode={settings.mode} /><div><div className="rd-identity">{assetTypeLabel(selected.type)}{selected.type !== 'mutual-fund' && ` · ${selected.exchange || 'NSE'}`}</div><h2 ref={headingRef} tabIndex={-1}>{selected.name || selected.ticker}</h2><p>{selected.type === 'mutual-fund' ? selected.amc || 'Fund house not recorded' : selected.ticker}{selected.isin && ` · ${selected.isin}`}</p></div></header>
          <div className="rd-tabs" role="tablist" aria-label="Investment research sections">{tabs.map((tab) => <button type="button" role="tab" id={`rd-tab-${tab.id}`} aria-selected={navigation.tab === tab.id} aria-controls="rd-tab-panel" tabIndex={navigation.tab === tab.id ? 0 : -1} key={tab.id} onClick={() => updateNavigation({ tab: tab.id })} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.findIndex((item) => item.id === navigation.tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
            updateNavigation({ tab: tabs[index].id }); document.getElementById(`rd-tab-${tabs[index].id}`)?.focus()
          }}>{tab.label}</button>)}</div>
          <div className="rd-tab-content" id="rd-tab-panel" role="tabpanel" aria-labelledby={`rd-tab-${navigation.tab}`} tabIndex={0}>
            {navigation.tab === 'overview' && <>
              <section className="rd-section"><div className="rd-section-head"><h3>Your holding</h3><span className="rd-basis">{basis}</span></div><dl className="rd-metrics"><Metric label="Holding value" value={amount(value, 'Unpriced')} /><Metric label="Unrealized return" value={privateValue(pnlPct == null ? 'Unavailable' : formatPercent(pnlPct), settings.hideValues)} movement={!settings.hideValues && pnl != null ? pnl >= 0 ? 'up' : 'down' : ''} /><Metric label="Portfolio weight" value={privateValue(weight == null ? 'Unavailable' : `${weight.toFixed(1)}%`, settings.hideValues)} /><Metric label="Invested amount" value={amount(selected.invested)} /><Metric label={selected.type === 'mutual-fund' ? 'Units held' : 'Quantity held'} value={privateValue(new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 }).format(selected.quantity), settings.hideValues)} /><Metric label={selected.type === 'mutual-fund' ? 'NAV per unit' : 'Price per unit'} value={amount(effectivePrice(selected, quotes))} /></dl>{weight == null && <p className="rd-footnote">Portfolio weight needs complete prices in one currency.</p>}<p className="rd-footnote">{selected.currency === 'USD' ? 'Values shown in USD, the asset currency.' : displayCurrency === 'USD' ? 'INR asset values displayed in USD using the available FX rate.' : settings.currency === 'USD' ? 'Values shown in INR because an FX rate is unavailable.' : 'Values shown in INR.'} Unrealized return is since purchase, not today.</p></section>
              <section className="rd-section"><div className="rd-section-head"><div><h3>A starting point for your review</h3><p>{selected.type === 'mutual-fund' ? 'Understand the mandate, costs and risk before comparing returns.' : selected.type === 'etf' ? 'Understand what it tracks and the cost of holding it.' : 'Follow the evidence, then revisit your reason to own.'}</p></div></div><ol className="rd-review-guide">{questions.slice(0, 3).map((question, index) => <li key={question.id}><span>{String(index + 1).padStart(2, '0')}</span>{question.text}</li>)}</ol><button type="button" className="btn btn--secondary" onClick={() => updateNavigation({ tab: 'sources' })}>Start my research <span aria-hidden="true">→</span></button></section>
              <section className="rd-section"><div className="rd-section-head"><h3>Go to the evidence</h3><button type="button" className="rd-text-button" onClick={() => updateNavigation({ tab: 'sources' })}>All sources →</button></div><SourceList links={links.slice(0, 2)} /><p className="rd-footnote">Sources open in a new tab and receive the investment name or symbol.</p></section>
              {!settings.hideValues && selected.type !== 'other' && <ResearchHistory key={key} position={selected} allowed={settings.allowExternalData} active={active} format={formatAmount} />}
            </>}
            {navigation.tab === 'sources' && <section className="rd-section"><div className="rd-section-head"><div><h3>Read at the source</h3><p>{selected.type === 'mutual-fund' ? 'Confirm that the scheme, plan and option match your holding.' : 'Confirm the listing and reporting period before using a figure.'}</p></div></div><SourceList links={links} /><p className="rd-callout">Search links help you locate a matching document. They do not verify the destination or its data. Company facts are provided by those sources.</p><p className="rd-footnote">Opening a link shares its investment query with the destination. Background lookups are {settings.allowExternalData ? 'enabled' : 'off'}.</p></section>}
          </div>
          {onGoTo && <footer className="rd-dossier-foot"><div><strong>Continue your review</strong><span>Explore related news or review your portfolio insights.</span></div><div className="rd-foot-actions"><button type="button" className="btn btn--secondary" onClick={() => onGoTo('holdings', selected)}>Related news</button><button type="button" className="rd-text-button" onClick={() => onGoTo('insights')}>Portfolio insights →</button></div></footer>}
        </>}
      </article>
    </div>
  </div>
}

function Metric({ label, value, movement = '' }: { label: string; value: string; movement?: string }) {
  return <div><dt>{label}</dt><dd className={movement}>{value}</dd></div>
}
function Avatar({ position, mode }: { position: Position; mode: 'light' | 'dark' }) {
  return <span className="rd-avatar" aria-hidden="true"><img src={monogramTile(position.type === 'mutual-fund' ? position.amc || position.name : position.ticker, position.type === 'etf' ? 'ETF' : undefined, mode)} alt="" /></span>
}
function SourceList({ links }: { links: ResearchLink[] }) {
  return <div className="rd-sources">{links.map((link) => <a href={link.url} target="_blank" rel="noreferrer" className="rd-source" key={link.label}><span className="rd-source-icon" aria-hidden="true"><ResearchSourceIcon label={link.label} /></span><span><strong>{link.label}</strong><span>{link.description}</span><small>{researchSource(link.url)} · {link.kind === 'search' ? 'Search for matching source' : 'External page'} · New tab</small></span><span className="rd-external" aria-hidden="true">↗</span></a>)}</div>
}
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg> }
