export type EntryRoute = 'landing' | 'workspace'

export function entryRoute(pathname: string, search: string): EntryRoute {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname
  if (new URLSearchParams(search).has('workspace')) return 'workspace'
  if (path === '/' || path === '/index.html') return 'landing'
  return 'workspace'
}
