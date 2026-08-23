import type { View } from './useStore'

export type EntryRoute =
  | { page: 'landing' }
  | { page: 'workspace'; view: View; redirectTo?: string }

const VIEW_PATHS: Record<View, string> = {
  overview: '/app',
  holdings: '/app/monitor',
  insights: '/app/insights',
  research: '/app/research',
  assistant: '/app/research/assistant',
  settings: '/app/settings',
}

const PATH_VIEWS = new Map(Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as View]))

export function pathForView(view: View): string {
  return VIEW_PATHS[view]
}

export function entryRoute(pathname: string, search: string): EntryRoute {
  const path = normalizePath(pathname)
  if (new URLSearchParams(search).has('workspace') || path === '/workspace') {
    return { page: 'workspace', view: 'overview', redirectTo: VIEW_PATHS.overview }
  }
  if (path === '/' || path === '/index.html') return { page: 'landing' }

  const view = PATH_VIEWS.get(path)
  if (view) return { page: 'workspace', view }
  if (path.startsWith('/app/')) return { page: 'workspace', view: 'overview', redirectTo: VIEW_PATHS.overview }
  return { page: 'landing' }
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}
