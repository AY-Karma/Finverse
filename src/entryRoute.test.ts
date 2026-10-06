import { describe, expect, it } from 'vitest'
import { entryRoute, pathForView } from './entryRoute'

describe('entryRoute', () => {
  it('opens the overview at the public root', () => {
    expect(entryRoute('/', '')).toEqual({ view: 'overview', redirectTo: '/app' })
    expect(entryRoute('/index.html', '')).toEqual({ view: 'overview', redirectTo: '/app' })
  })

  it.each([
    ['/app', 'overview'],
    ['/app/monitor', 'holdings'],
    ['/app/insights', 'insights'],
    ['/app/research', 'research'],
    ['/app/settings', 'settings'],
  ] as const)('maps %s to the %s view', (path, view) => {
    expect(entryRoute(path, '')).toEqual({ view })
    expect(pathForView(view)).toBe(path)
  })

  it('redirects legacy workspace links to the app root', () => {
    expect(entryRoute('/', '?workspace=1')).toEqual({ view: 'overview', redirectTo: '/app' })
    expect(entryRoute('/workspace', '')).toEqual({ view: 'overview', redirectTo: '/app' })
  })

  it('redirects unknown paths to the app root', () => {
    expect(entryRoute('/app/unknown', '')).toEqual({ view: 'overview', redirectTo: '/app' })
    expect(entryRoute('/unknown', '')).toEqual({ view: 'overview', redirectTo: '/app' })
  })

  it('recognizes app paths with trailing slashes and view-specific queries', () => {
    expect(entryRoute('/app/research/', '?holding=RELIANCE')).toEqual({ view: 'research' })
  })
})
