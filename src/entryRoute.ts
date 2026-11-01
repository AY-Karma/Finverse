import type { View } from './useStore'

export type EntryRoute = { view: View; redirectTo?: string; notFound?: true }

const VIEW_PATHS: Record<View, string> = {
  overview: '/app',
  holdings: '/app/monitor',
  insights: '/app/insights',
  research: '/app/research',
  settings: '/app/settings',
}

const PATH_VIEWS = new Map(Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as View]))

export function pathForView(view: View): string {
  return VIEW_PATHS[view]
}

export function entryRoute(pathname: string, search: string): EntryRoute {
  const path = normalizePath(pathname)
  if (new URLSearchParams(search).has('workspace') || path === '/workspace' || path === '/' || path === '/index.html') {
    return { view: 'overview', redirectTo: VIEW_PATHS.overview }
  }

  const view = PATH_VIEWS.get(path)
  if (view) return { view }
  return { view: 'overview', notFound: true }
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}
