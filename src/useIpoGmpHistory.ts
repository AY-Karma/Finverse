import { useEffect, useRef, useState } from 'react'
import { cachedIpoGmpHistory, loadIpoGmpHistory } from './ipoGmpHistory'
import { isIpoGmpHistorySlug, type IpoGmpHistoryResponse, type IpoGmpPoint } from './ipoGmpHistoryProtocol'
import type { IpoGmp, IpoIssue } from './ipoProtocol'

export interface HistoryState {
  status: 'loading' | 'ready' | 'error'
  gmp: IpoGmp | null
  points: IpoGmpPoint[]
  sourceUrl: string | null
  sourceUpdatedAt: number | null
}
const emptyHistory = (status: HistoryState['status']): HistoryState => ({ status, gmp: null, points: [], sourceUrl: null, sourceUpdatedAt: null })

function readyHistory(value: IpoGmpHistoryResponse): HistoryState {
  return { status: 'ready', gmp: value.gmp, points: value.points ?? [], sourceUrl: value.sourceUrl ?? value.gmp?.sourceUrl ?? null, sourceUpdatedAt: value.sourceUpdatedAt ?? value.gmp?.sourceUpdatedAt ?? null }
}

function quoteMatchesOffer(issue: IpoIssue, gmp: IpoGmp): boolean {
  return Boolean(issue.openDate && issue.listingDate && gmp.asOfDate && issue.priceMax
    && gmp.asOfDate >= issue.openDate && gmp.asOfDate < issue.listingDate
    && gmp.percent !== null && Math.abs(gmp.amount / issue.priceMax * 100 - gmp.percent) < .02)
}

export function ipoHistorySlug(issue: IpoIssue): string | null {
  return issue.status === 'LISTED' && !issue.gmp ? ipoTrendSlug(issue) : null
}

export function ipoTrendSlug(issue: IpoIssue): string | null {
  if (!issue.id.startsWith('xflot:')) return null
  const slug = issue.id.slice(6)
  return isIpoGmpHistorySlug(slug) ? slug : null
}

export function useIpoGmpHistory(issues: IpoIssue[], allowed: boolean, openedIssue = '') {
  const key = allowed ? [...new Set(issues.map(ipoTrendSlug).filter((slug): slug is string => slug !== null))].sort().join(',') : ''
  const [states, setStates] = useState<Record<string, HistoryState>>({})
  const scope = useRef<{ key: string; active: boolean } | null>(null)

  useEffect(() => {
    if (!key) return
    const currentScope = { key, active: true }
    scope.current = currentScope
    const jobs = key.split(',')
    setStates((current) => Object.fromEntries(jobs.filter((slug) => current[slug]).map((slug) => [slug, current[slug]])))
    let cursor = 0
    const work = async () => {
      while (currentScope.active && cursor < jobs.length) {
        const slug = jobs[cursor++]
        try {
          const value = await loadIpoGmpHistory(slug)
          if (currentScope.active) setStates((current) => ({ ...current, [slug]: readyHistory(value) }))
        } catch {
          if (currentScope.active) setStates((current) => ({ ...current, [slug]: { ...(current[slug] ?? emptyHistory('error')), status: 'error' } }))
        }
      }
    }
    void work()
    void work()
    return () => { currentScope.active = false }
  }, [key, openedIssue])

  const retry = (slug: string) => {
    const currentScope = scope.current
    if (!allowed || !currentScope?.active || currentScope.key !== key || !key.split(',').includes(slug)) return
    setStates((current) => ({ ...current, [slug]: { ...(current[slug] ?? emptyHistory('loading')), status: 'loading' } }))
    void loadIpoGmpHistory(slug, true)
      .then((value) => { if (currentScope.active) setStates((current) => ({ ...current, [slug]: readyHistory(value) })) })
      .catch(() => { if (currentScope.active) setStates((current) => ({ ...current, [slug]: { ...(current[slug] ?? emptyHistory('error')), status: 'error' } })) })
  }

  const visible: Record<string, HistoryState> = {}
  if (key) for (const slug of key.split(',')) {
    const cached = cachedIpoGmpHistory(slug)
    const state = states[slug]?.status === 'loading' || states[slug]?.status === 'error' ? states[slug] : cached ? readyHistory(cached) : states[slug] ?? emptyHistory('loading')
    const issue = issues.find((candidate) => ipoTrendSlug(candidate) === slug)!
    const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)
    const wrongPrice = state.gmp && issue.priceMax && state.gmp.percent !== null && Math.abs(state.gmp.amount / issue.priceMax * 100 - state.gmp.percent) >= .02
    const points = wrongPrice || !state.sourceUrl ? [] : state.points.filter((point) => point.date <= today && (!issue.listingDate || point.date < issue.listingDate))
    visible[slug] = { ...state, points, gmp: ipoHistorySlug(issue) && state.gmp && quoteMatchesOffer(issue, state.gmp) ? state.gmp : null }
  }
  return { histories: visible, retry }
}
