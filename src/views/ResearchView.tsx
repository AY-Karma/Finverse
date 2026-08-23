import { useEffect, useMemo, useState } from 'react'
import type { Currency, Position } from '../types'
import { instrumentLabel } from '../instruments'
import { marketLinks, researchSource, resolveScreenerCompanyPath, screenerFallbackSearchUrl, type ResearchLink } from '../research'
import { isinLogoUrl, monogramTile, resolveIsin, tickerLogoUrl } from '../logos'
import { privateValue, visibleQuotes } from '../privacy'
import { useStore } from '../useStore'
import { formatCurrency, formatPercent, positionPnl, positionPnlPct, positionValue } from '../valuation'
import { PortfolioRequiredState } from './PortfolioRequiredState'

type Row = { position: Position; value: number; pnl: number | null; pnlPct: number | null }

/** One in-flight resolution per ticker, however many cards/effects ask. */
const pendingPaths = new Map<string, Promise<string>>()

function resolveOnce(ticker: string): Promise<string> {
  let pending = pendingPaths.get(ticker)
  if (!pending) {
    pending = resolveScreenerCompanyPath(ticker)
    pendingPaths.set(ticker, pending)
  }
  return pending
}

export function ResearchView({ onOpenAssistant, onRequestImport }: { onOpenAssistant: () => void; onRequestImport: () => void }) {
  const { positions, liveQuotes, fxRate, settings } = useStore()
  const currency = settings.currency || 'INR'
  const allowExternal = settings.allowExternalData
  const [query, setQuery] = useState('')
  const [paths, setPaths] = useState<Record<string, string>>({})
  const quotes = useMemo(
    () => visibleQuotes(settings.allowExternalData, liveQuotes),
    [settings.allowExternalData, liveQuotes],
  )
  const rows = useMemo(() => positions.map((position) => ({
    position,
    value: positionValue(position, quotes),
    pnl: positionPnl(position, quotes),
    pnlPct: positionPnlPct(position, quotes),
  })).sort((a, b) => b.value - a.value), [positions, quotes])
  const visibleRows = useMemo(() => filterRows(rows, query), [rows, query])
  const allocationGroups = new Set(positions.map((position) => position.sector || position.category || position.type)).size
  const aiConfigured = settings.provider === 'ollama' || Boolean(settings.provider && settings.apiKey)

  // Resolve canonical Screener company pages once per holding so every card can
  // render a plain anchor instead of a click-then-redirect dance.
  useEffect(() => {
    if (!allowExternal) return
    let cancelled = false
    for (const ticker of uniqueEquityTickers(positions)) {
      void resolveOnce(ticker)
        .then((path) => {
          if (!cancelled) setPaths((prev) => (prev[ticker] ? prev : { ...prev, [ticker]: path }))
        })
        .catch(() => { /* chip falls back to the site-search link */ })
    }
    return () => { cancelled = true }
  }, [positions, allowExternal])

  if (positions.length === 0) {
    return (
      <PortfolioRequiredState
        area="04 · Research"
        description="Bring in your holdings to build a private research desk with a dossier for every investment."
        onImport={onRequestImport}
      />
    )
  }

  return <>
    <div className="page-head enter d0">
      <div>
        <div className="page-eyebrow">04 · Research</div>
        <h1 className="page-title">Research desk</h1>
      </div>
      <p className="page-sub">A dossier card per holding: fundamentals, charts, quotes and news as clearly labeled third-party links. Your quantities and cost basis never leave this browser.</p>
    </div>

    <section className="panel research-brief enter d1">
      <div>
        <span className="score-label">Portfolio context</span>
        <strong>{positions.length} holding{positions.length === 1 ? '' : 's'} · {allocationGroups} allocation group{allocationGroups === 1 ? '' : 's'}</strong>
        <span className="hint">{allowExternal ? 'Screener links point at each company’s canonical page once resolved.' : 'External data is off, so Screener links fall back to site search.'}</span>
      </div>
      <div>
        <button type="button" className="btn btn--primary" onClick={onOpenAssistant}>Ask AI about this portfolio</button>
        <span className="hint">{aiConfigured ? 'Uses your configured provider and consent settings.' : 'Provider setup is required before anything is sent.'}</span>
      </div>
    </section>

    <div className="research-toolbar enter d2">
      <input
        className="input research-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={`Filter ${rows.length} holding${rows.length === 1 ? '' : 's'} by name or ticker…`}
        aria-label="Filter research cards"
      />
      <span className="section-index">{visibleRows.length} shown</span>
    </div>

    {visibleRows.length === 0 ? (
      <section className="panel research-empty enter">
        <strong>No holding matches “{query}”</strong>
        <p className="hint">Clear the filter to see the full list.</p>
        <button className="btn btn--secondary btn--small" type="button" onClick={() => setQuery('')}>Clear filter</button>
      </section>
    ) : (
      <section className="research-grid enter d3" aria-label="Portfolio research dossiers">
        {visibleRows.map(({ position, value, pnl, pnlPct }) => (
          <DossierCard
            key={position.id}
            position={position}
            value={value}
            pnl={pnl}
            pnlPct={pnlPct}
            currency={currency}
            fxUsdInr={fxRate?.usdInr}
            hideValues={settings.hideValues}
            mode={settings.mode}
            screenerPath={paths[position.ticker.replace(/\.(NS|NSE|BSE)$/, '').toUpperCase()]}
            showLogos={allowExternal}
          />
        ))}
      </section>
    )}
  </>
}

function DossierCard({ position, value, pnl, pnlPct, currency, fxUsdInr, hideValues, mode, screenerPath, showLogos }: {
  position: Position
  value: number
  pnl: number | null
  pnlPct: number | null
  currency: Currency | undefined
  fxUsdInr?: number
  hideValues: boolean
  mode: 'dark' | 'light'
  screenerPath?: string
  showLogos: boolean
}) {
  const isFund = position.type === 'mutual-fund'
  const tickerBase = position.ticker.replace(/\.(NS|NSE|BSE)$/, '').toUpperCase()
  const displayName = position.name || position.sector || 'Imported holding'
  const links = cardChips(position, displayName, tickerBase, screenerPath)

  return <article className="panel research-card">
    <div className="research-id">
      <LogoAvatar isin={position.isin} tickerBase={tickerBase} exchange={position.exchange} isFund={isFund} etf={position.type === 'etf'} showLogos={showLogos} mode={mode} />
      <span className="research-id-copy">
        <span className="sym">{instrumentLabel(position)}</span>
        <span className="holdings-name" title={displayName}>{displayName}</span>
        <span className="research-tags"><span className="research-tag">{typeLabel(position)}</span>{position.exchange && <span className="research-tag">{position.exchange}</span>}</span>
      </span>
      <span className="research-value-wrap">
        <span className="research-value">{privateValue(formatCurrency(value, currency, fxUsdInr), hideValues)}</span>
        {pnl != null && !hideValues && pnlPct != null && (
          <span className={`research-pnl ${pnl >= 0 ? 'up' : 'down'}`}>
            {pnl >= 0 ? '▲' : '▼'} {formatPercent(pnlPct)}
          </span>
        )}
      </span>
    </div>

    <div className="research-chips">
      {links.map((link) => (
        <a key={link.label + link.url} className="research-chip" href={link.url} target="_blank" rel="noreferrer" title={`${researchSource(link.url)} · opens in a new tab`}>
          {link.label}<i>{researchSource(link.url)}</i>
        </a>
      ))}
    </div>
  </article>
}

/** Deterministic chip set per holding type; nothing here can 404 by construction. */
function cardChips(position: Position, displayName: string, tickerBase: string, screenerPath?: string): ResearchLink[] {
  const news: ResearchLink = {
    label: 'News',
    url: `https://news.google.com/search?q=${encodeURIComponent(`${displayName} ${tickerBase} stock`)}`,
  }
  if (position.type === 'mutual-fund') {
    return [...marketLinks(position), news]
  }
  const screener: ResearchLink = {
    label: 'Screener',
    url: screenerPath
      ? `https://www.screener.in${screenerPath}`
      : screenerFallbackSearchUrl(displayName === 'Imported holding' ? tickerBase : displayName),
  }
  return [screener, ...marketLinks(position).filter((link) => link.label !== 'Screener'), news]
}

function LogoAvatar({ isin, tickerBase, exchange, isFund, etf, showLogos, mode }: {
  isin?: string
  tickerBase: string
  exchange?: Position['exchange']
  isFund: boolean
  /** ETFs get a labelled badge tile instead of ticker initials when no mark exists. */
  etf?: boolean
  showLogos: boolean
  mode: 'dark' | 'light'
}) {
  // Candidate chain: known ISIN → ISIN resolved from the NSE master → ticker CDN.
  // Failures are tracked per URL (not by index) so a candidate that lands later —
  // e.g. an ISIN resolved after first paint — still gets its shot without
  // replaying URLs that already failed.
  const [resolvedIsin, setResolvedIsin] = useState<string | null>(null)
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(() => new Set())
  const needsLookup = showLogos && !isin

  useEffect(() => {
    setResolvedIsin(null)
    setFailedUrls(new Set())
  }, [tickerBase])

  useEffect(() => {
    if (!needsLookup || resolvedIsin) return
    let cancelled = false
    void resolveIsin(tickerBase)
      .then((isin) => { if (!cancelled && isin) setResolvedIsin(isin) })
      .catch(() => { /* the monogram tile covers it */ })
    return () => { cancelled = true }
  }, [needsLookup, resolvedIsin, tickerBase])

  const candidates = useMemo(
    () => (showLogos
      ? [...new Set(
          [isinLogoUrl(isin), isinLogoUrl(resolvedIsin), tickerLogoUrl(tickerBase, exchange)]
            .filter((url): url is string => Boolean(url)),
        )]
      : []),
    [isin, resolvedIsin, tickerBase, exchange, showLogos],
  )
  const logoUrl = candidates.find((url) => !failedUrls.has(url)) ?? null

  return (
    <span className={`research-avatar${isFund && !logoUrl ? ' research-avatar--fund' : ''}`} aria-hidden="true">
      <img
        key={logoUrl ?? 'tile'}
        src={logoUrl ?? monogramTile(tickerBase, etf ? 'ETF' : undefined, mode)}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={logoUrl ? () => setFailedUrls((prev) => new Set(prev).add(logoUrl)) : undefined}
      />
    </span>
  )
}

function typeLabel(position: Position): string {
  if (position.type === 'mutual-fund') return 'Fund'
  if (position.type === 'etf') return 'ETF'
  if (position.type === 'stock' || (position.type === 'other' && position.exchange)) return 'Stock'
  return 'Holding'
}

function uniqueEquityTickers(positions: Position[]): string[] {
  return [...new Set(
    positions
      .filter((position) => position.type !== 'mutual-fund')
      .map((position) => position.ticker.replace(/\.(NS|NSE|BSE)$/, '').toUpperCase()),
  )]
}

function filterRows(rows: Row[], query: string): Row[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter(({ position }) =>
    `${position.ticker} ${position.name} ${position.sector ?? ''}`.toLowerCase().includes(needle))
}
