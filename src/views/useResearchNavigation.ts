import { useEffect, useState } from 'react'

export type ResearchTab = 'overview' | 'sources'
export interface ResearchNavigation {
  holding: string
  query: string
  asset: string
  group: string
  sort: 'name' | 'value'
  page: number
  tab: ResearchTab
}

function readNavigation(): ResearchNavigation {
  const params = new URLSearchParams(window.location.search)
  return {
    holding: params.get('holding') || '', query: (params.get('q') || '').slice(0, 200), asset: params.get('asset') || 'all',
    group: params.get('group') || 'all', sort: params.get('sort') === 'value' ? 'value' : 'name',
    page: Math.min(10000, Math.max(0, Number(params.get('page')) || 0)),
    tab: params.get('tab') === 'notes' || params.get('tab') === 'sources' ? 'sources' : 'overview',
  }
}

export function useResearchNavigation(active: boolean, onUrlChange?: (url: string) => void) {
  const [navigation, setNavigation] = useState(readNavigation)
  useEffect(() => {
    if (!active) return
    const onPopState = () => {
      if (window.location.pathname !== '/app/research') return
      const url = new URL(window.location.href)
      if (url.searchParams.get('tab') === 'notes') {
        url.searchParams.set('tab', 'sources')
        window.history.replaceState(window.history.state, '', url.pathname + url.search)
      }
      setNavigation(readNavigation())
      onUrlChange?.(window.location.pathname + window.location.search)
    }
    onPopState()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [active, onUrlChange])
  function updateNavigation(patch: Partial<ResearchNavigation>, push = false) {
    const next = { ...navigation, ...patch }
    const url = new URL(window.location.href)
    const fields = { holding: next.holding, q: next.query, asset: next.asset === 'all' ? '' : next.asset, group: next.group === 'all' ? '' : next.group, sort: next.sort === 'name' ? '' : next.sort, page: next.page ? String(next.page) : '', tab: next.tab === 'overview' ? '' : next.tab }
    for (const [key, value] of Object.entries(fields)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key) }
    const state = push ? { researchListUrl: window.location.pathname + window.location.search } : window.history.state
    window.history[push ? 'pushState' : 'replaceState'](state, '', url.pathname + url.search)
    onUrlChange?.(url.pathname + url.search)
    setNavigation(next)
  }
  function returnToHoldings() {
    if (window.history.state?.researchListUrl) window.history.back()
    else updateNavigation({ holding: '', tab: 'overview' })
  }
  return { navigation, updateNavigation, returnToHoldings }
}
