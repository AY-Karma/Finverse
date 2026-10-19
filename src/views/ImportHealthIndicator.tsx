import { useEffect, useId, useState } from 'react'
import type { DitherColor } from '../components/dither-kit/palette'
import { getImportFreshness, type ImportFreshness } from '../importFreshness'
import { DitherBar } from './DitherBar'
import './ImportHealthIndicator.css'

const STATUS: Record<ImportFreshness, { label: string; description: string; color: DitherColor }> = {
  healthy: { label: 'Healthy import', description: 'Imported within the last 7 days.', color: 'green' },
  aging: { label: 'Aging import', description: 'Imported over 7 days ago, up to 21 days. Consider updating your holdings.', color: 'yellow' },
  old: { label: 'Old import', description: 'Imported over 21 days ago. Import a recent holdings file.', color: 'red' },
  unknown: { label: 'Import age unavailable', description: 'The import date is unavailable.', color: 'grey' },
}

export function ImportHealthIndicator({ importedAt }: { importedAt: number }) {
  const descriptionId = useId()
  const [now, setNow] = useState(Date.now)
  const freshness = getImportFreshness(importedAt, now)
  const status = STATUS[freshness]

  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh() }
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [importedAt])

  return <span className="import-health" data-status={freshness} role="img" tabIndex={0}
    aria-label={status.label} aria-describedby={descriptionId} title={`${status.label}. ${status.description}`}>
    <DitherBar className="import-health-texture" segments={[{ value: 1, color: status.color }]} />
    <span className="sr-only" id={descriptionId}>{status.description}</span>
  </span>
}
