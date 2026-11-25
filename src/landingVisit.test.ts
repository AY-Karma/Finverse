import { describe, expect, it } from 'vitest'
import { isFirstVisit, markLandingSeen } from './landingVisit'

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries))
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

describe('landing visit', () => {
  it('treats an empty browser as a first visit until the landing page is seen', () => {
    const storage = memoryStorage()
    expect(isFirstVisit(storage)).toBe(true)
    markLandingSeen(storage)
    expect(isFirstVisit(storage)).toBe(false)
  })

  it('skips the landing page for a browser that already holds a workspace', () => {
    expect(isFirstVisit(memoryStorage({ 'finverse:folios': '[]' }))).toBe(false)
    expect(isFirstVisit(memoryStorage({ 'finverse:settings': '{}' }))).toBe(false)
  })

  it('opens the app when storage is unavailable', () => {
    const blocked = { getItem: () => { throw new Error('blocked') } }
    expect(isFirstVisit(blocked)).toBe(false)
  })
})
