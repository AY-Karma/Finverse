import { describe, expect, it } from 'vitest'
import { entryRoute } from './entryRoute'

describe('entryRoute', () => {
  it('uses the landing page at the public root', () => {
    expect(entryRoute('/', '')).toBe('landing')
    expect(entryRoute('/index.html', '')).toBe('landing')
  })

  it('uses the workspace for app paths', () => {
    expect(entryRoute('/', '?workspace=1')).toBe('workspace')
    expect(entryRoute('/workspace', '')).toBe('workspace')
  })
})
