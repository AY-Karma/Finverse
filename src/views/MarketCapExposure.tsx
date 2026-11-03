import { useEffect, useMemo, useState } from 'react'
import type { LiveQuote, Position } from '../types'
import { calculateMarketCapExposure, type CapBand } from '../marketCapExposure'
import { AMFI_CLASSIFICATION_PAGE, type MarketCapReference } from '../marketCapProtocol'
import { getCachedMarketCapReference, loadMarketCapReference } from '../marketCapReference'
import { isIsin } from '../nsePricingProtocol'
import { formatCurrency } from '../valuation'
import { HiddenValuesState } from './HiddenValuesState'
import './MarketCapExposure.css'
import { useMarketCapPositions } from '../useMarketCapPositions'

export interface MarketCapSelection { label: string; positionIds: string[] }

interface MarketCapExposureProps {
  positions: Position[]
  quotes: Record<string, LiveQuote>
  hideValues: boolean
  allowExternalData?: boolean
  active?: boolean
  onHighlight?: (selection: MarketCapSelection | null) => void
}

export function MarketCapExposure({ positions, quotes, hideValues, allowExternalData = false, active = true, onHighlight }: MarketCapExposureProps) {
  const resolved = useMarketCapPositions(positions, quotes, allowExternalData, hideValues)
  const [reference, setReference] = useState<MarketCapReference | null>(() => allowExternalData && !hideValues ? getCachedMarketCapReference() : null)
  const [hoveredBand, setHoveredBand] = useState<CapBand | null>(null)
  const [focusedBand, setFocusedBand] = useState<CapBand | null>(null)
  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const hasEligibleStocks = resolved.positions.some((position) => position.type === 'stock' && !position.identityIssue && isIsin(position.isin))

  useEffect(() => {
    if (!allowExternalData || hideValues || !hasEligibleStocks) {
      setReference(null)
      setLoading(false)
      setUnavailable(false)
      return
    }
    const controller = new AbortController()
    const cached = getCachedMarketCapReference()
    setReference(cached)
    setLoading(!cached)
    setUnavailable(false)
    void loadMarketCapReference(controller.signal).then((value) => {
      if (!controller.signal.aborted) setReference(value)
    }).catch(() => {
      if (!controller.signal.aborted) { setReference(null); setUnavailable(true) }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [allowExternalData, hideValues, hasEligibleStocks])
  useEffect(() => { if (hideValues || !active) { setHoveredBand(null); setFocusedBand(null) } }, [hideValues, active])
  const result = useMemo(() => calculateMarketCapExposure(resolved.positions, resolved.quotes, allowExternalData ? reference?.records ?? [] : []), [resolved.positions, resolved.quotes, reference, allowExternalData])
  const visibleBuckets = result.buckets.filter((bucket) => bucket.value > 0)
  const selected = visibleBuckets.find((bucket) => bucket.band === (hoveredBand ?? focusedBand))
  useEffect(() => {
    onHighlight?.(active && !hideValues && selected ? { label: selected.label, positionIds: [...new Set(selected.members.map((member) => member.positionId))] } : null)
  }, [selected, active, hideValues, onHighlight])
  useEffect(() => () => onHighlight?.(null), [onHighlight])

  return <div className="market-cap-exposure">
    {hideValues ? <HiddenValuesState /> : <>
      <div className="market-cap-ribbon" role="img" aria-label={`Market-cap exposure: ${visibleBuckets.map((bucket) => `${bucket.label} ${bucket.weight.toFixed(1)}%`).join(', ')}`}>
        {visibleBuckets.map((bucket) => <span key={bucket.band} className={`market-cap-tone--${bucket.band}${selected && selected.band !== bucket.band ? ' is-dim' : ''}`} style={{ flexGrow: bucket.weight }} onMouseEnter={() => setHoveredBand(bucket.band)} onMouseLeave={() => setHoveredBand(null)} />)}
      </div>
      <div className="market-cap-bands" aria-label="Market-cap allocation">
        {visibleBuckets.map((bucket) => <button type="button" key={bucket.band} className={`market-cap-band market-cap-band--${bucket.band}`} aria-pressed={selected?.band === bucket.band} onMouseEnter={() => setHoveredBand(bucket.band)} onMouseLeave={() => setHoveredBand(null)} onFocus={() => setFocusedBand(bucket.band)} onBlur={() => setFocusedBand(null)} onClick={() => setFocusedBand(bucket.band)}>
          <span className="market-cap-band-label"><i className={`market-cap-tone--${bucket.band}`} aria-hidden="true" />{bucket.label}</span>
          <span className="market-cap-band-weight">{bucket.weight.toFixed(1)}%</span>
          <span className="market-cap-band-value">{formatCurrency(bucket.value)}</span>
        </button>)}
      </div>
      {(loading || resolved.loading) && <p className="market-cap-note" role="status">Loading market classifications</p>}
      {!allowExternalData && <p className="market-cap-note">External market data is off</p>}
      {unavailable && <p className="market-cap-note" role="status">AMFI classifications are temporarily unavailable</p>}
      <div className="market-cap-source"><span>Source</span><p className="market-cap-note">Stocks match by exact ISIN against <a href={AMFI_CLASSIFICATION_PAGE} target="_blank" rel="noreferrer">AMFI's published classifications </a>.</p></div>
    </>}
  </div>
}
