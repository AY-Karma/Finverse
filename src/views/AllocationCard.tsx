import { useMemo, useState, useSyncExternalStore } from 'react'
import { formatCurrency, type Allocation } from '../valuation'
import { privateValue } from '../privacy'
import { AllocationDonut, type DonutSlice } from './AllocationDonut'
import { HiddenValuesState } from './HiddenValuesState'

const SEGMENT_CAP = 7
const CALLOUT_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)'

function subscribeCalloutQuery(onChange: () => void) {
  const query = window.matchMedia?.(CALLOUT_QUERY)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

/** Desktop pointers get leader-line callouts; touch and narrow screens keep details in the ring. */
function useCalloutLayout() {
  return useSyncExternalStore(subscribeCalloutQuery, () => window.matchMedia?.(CALLOUT_QUERY).matches ?? false, () => false)
}

/** Allocation chart with portfolio composition and holding details. */
export function AllocationCard({
  allocations,
  hideValues,
}: {
  allocations: Allocation[]
  hideValues: boolean
}) {
  const [active, setActive] = useState<number | null>(null)
  const callout = useCalloutLayout()
  const mask = (text: string) => privateValue(text, hideValues)

  const valued = useMemo(() => allocations.filter((a) => a.value > 0), [allocations])
  const total = valued.reduce((sum, item) => sum + item.value, 0)
  const slices = useMemo<DonutSlice[]>(() => {
    const top = valued.slice(0, SEGMENT_CAP)
    const restValue = valued.slice(SEGMENT_CAP).reduce((sum, item) => sum + item.value, 0)
    return restValue > 0
      ? [...top, { symbol: `Other · ${valued.length - top.length} more`, value: restValue }]
      : top
  }, [valued])

  if (hideValues) return <HiddenValuesState />

  if (valued.length === 0 || total <= 0) {
    return <div className="alloc-empty muted">No valued holdings yet — refresh prices or check the ledger.</div>
  }

  const activeSlice = active != null ? slices[active] : undefined
  const activeWeight = activeSlice && total > 0 ? (activeSlice.value / total) * 100 : 0

  return (
    <div className="alloc-split">
      <section className="alloc-half alloc-top">
        <div className="alloc-donut">
          <AllocationDonut slices={slices} active={active} onActiveChange={setActive}
            callout={callout && activeSlice ? { name: activeSlice.symbol, weight: `${activeWeight.toFixed(1)}%`, value: formatCurrency(activeSlice.value) } : null} />
          <div className="alloc-ring-center">
            <div className="alloc-ring-core" aria-hidden="true">
              {activeSlice && !callout ? (
                <>
                  <span className="ring-sym" title={mask(activeSlice.symbol)}>{mask(activeSlice.symbol)}</span>
                  <strong>{mask(`${activeWeight.toFixed(1)}%`)}</strong>
                  <small>{mask(formatCurrency(activeSlice.value))}</small>
                </>
              ) : (
                <>
                  <span>Holdings</span>
                  <strong>{valued.length}</strong>
                </>
              )}
            </div>
          </div>
        </div>
        <ul className="sr-only">
          {slices.map((item) => (
            <li key={item.symbol}>{mask(`${item.symbol} ${((item.value / total) * 100).toFixed(1)}%`)}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
