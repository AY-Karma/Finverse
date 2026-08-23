import { describe, expect, it } from 'vitest'
import { entryRoute, pathForView } from './entryRoute'

describe('entryRoute', () => {
  it('uses the landing page at the public root', () => {
    expect(entryRoute('/', '')).toEqual({ page: 'landing' })
    expect(entryRoute('/index.html', '')).toEqual({ page: 'landing' })
  })

  it.each([
    ['/app', 'overview'],
    ['/app/monitor', 'holdings'],
    ['/app/insights', 'insights'],
    ['/app/research', 'research'],
    ['/app/research/assistant', 'assistant'],
    ['/app/settings', 'settings'],
  ] as const)('maps %s to the %s view', (path, view) => {
    expect(entryRoute(path, '')).toEqual({ page: 'workspace', view })
    expect(pathForView(view)).toBe(path)
  })

  it('redirects legacy workspace links to the app root', () => {
    expect(entryRoute('/', '?workspace=1')).toEqual({ page: 'workspace', view: 'overview', redirectTo: '/app' })
    expect(entryRoute('/workspace', '')).toEqual({ page: 'workspace', view: 'overview', redirectTo: '/app' })
  })

  it('canonicalizes unknown app paths and leaves unrelated paths public', () => {
    expect(entryRoute('/app/unknown', '')).toEqual({ page: 'workspace', view: 'overview', redirectTo: '/app' })
    expect(entryRoute('/unknown', '')).toEqual({ page: 'landing' })
  })
})
