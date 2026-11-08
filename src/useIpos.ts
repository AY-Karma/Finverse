import { useEffect, useState } from 'react'
import { cachedIpos, loadIpos } from './ipos'
import type { IpoFeed } from './ipoProtocol'

export function useIpos(allowed: boolean) {
  const [feed, setFeed] = useState<IpoFeed | null>(() => allowed ? cachedIpos() : null)
  const [loading, setLoading] = useState(allowed)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!allowed) return
    let active = true
    setLoading(true)
    setError(null)
    void loadIpos(revision > 0).then((next) => { if (active) setFeed(next) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'IPOs could not be loaded.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [allowed, revision])

  return { feed: allowed ? feed : null, loading: allowed && loading, error: allowed ? error : null, refresh: () => setRevision((value) => value + 1) }
}
