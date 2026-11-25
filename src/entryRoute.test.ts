import { describe, expect, it } from 'vitest'
import { entryRoute, pathForView } from './entryRoute'

describe('entryRoute', () => {
  it('shows the landing page at the public root on a first visit only', () => {
    expect(entryRoute('/', '', true)).toEqual({ view: 'overview', landing: true })
    expect(entryRoute('/index.html', '', true)).toEqual({ view: 'overview', landing: true })
    expect(entryRoute('/', '')).toEqual({ view: 'overview', redirectTo: '/app' })
    expect(entryRoute('/index.html', '')).toEqual({ view: 'overview', redirectTo: '/app' })
  })

  it('always shows the landing page at /welcome', () => {
    expect(entryRoute('/welcome', '')).toEqual({ view: 'overview', landing: true })
    expect(entryRoute('/welcome/', '', true)).toEqual({ view: 'overview', landing: true })
  })

  it.each([
    ['/app', 'overview'],
    ['/app/monitor', 'holdings'],
    ['/app/insights', 'insights'],
    ['/app/research', 'research'],
    ['/app/settings', 'settings'],
  ] as const)('maps %s to the %s view', (path, view) => {
    expect(entryRoute(path, '', true)).toEqual({ view })
    expect(pathForView(view)).toBe(path)
  })

  it('redirects legacy workspace links to the app root', () => {
    expect(entryRoute('/', '?workspace=1', true)).toEqual({ view: 'overview', redirectTo: '/app' })
    expect(entryRoute('/workspace', '')).toEqual({ view: 'overview', redirectTo: '/app' })
  })

  it('keeps unknown paths for the not-found screen', () => {
    expect(entryRoute('/app/unknown', '')).toEqual({ view: 'overview', notFound: true })
    expect(entryRoute('/unknown', '')).toEqual({ view: 'overview', notFound: true })
  })

  it('recognizes app paths with trailing slashes and view-specific queries', () => {
    expect(entryRoute('/app/research/', '?holding=RELIANCE')).toEqual({ view: 'research' })
  })
})
