// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarketCalendar } from './MarketCalendar'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.removeItem('finverse:marketHolidayNotice')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const details = () => container.querySelector('details')!
const toggle = () => container.querySelector('summary')!.click()
const render = (date: string) => act(async () => root.render(<MarketCalendar now={new Date(date)} />))
const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms) })

describe('market calendar disclosure', () => {
  it.each([
    '2026-10-19T04:00:00Z', // Regular trading day.
    '2026-10-04T04:00:00Z', // Weekend, without an exchange holiday.
    '2026-11-08T04:00:00Z', // Special Muhurat session, not a full-day closure.
    '2027-01-04T04:00:00Z', // Unavailable calendar.
  ])('stays collapsed without a confirmed holiday on %s', async (date) => {
    await render(date)
    expect(details().open).toBe(false)
    await advance(6_000)
    expect(details().open).toBe(false)
    expect(container.querySelector('.market-calendar-holiday')).toBeNull()
  })

  it('opens on request and stays open until the user closes it', async () => {
    await render('2026-10-19T04:00:00Z')
    await act(async () => toggle())
    expect(details().open).toBe(true)
    expect(details().textContent).toContain('Last regular close')
    expect(container.querySelector('.market-holiday')?.textContent).toBe('Upcoming Holiday - Tue 20 Oct, Dussehra in 1 day')
    expect(container.querySelectorAll('.market-holiday')).toHaveLength(1)
    expect(details().textContent).not.toContain('Muhurat trading')
    expect(details().textContent).not.toContain('Regular sessions only')
    expect(container.querySelector('a')).toBeNull()
    await advance(10_000)
    expect(details().open).toBe(true)
    await act(async () => toggle())
    expect(details().open).toBe(false)
  })

  it('shows the IST holiday for six seconds without resetting on clock updates', async () => {
    await render('2026-10-19T18:30:00Z')
    expect(details().open).toBe(true)
    expect(container.querySelector('.market-calendar-holiday')?.textContent).toBe('Market closed today · Dussehra')
    expect(container.querySelector('.market-holiday')?.textContent).toBe('Holiday Today - Tue 20 Oct, Dussehra')
    await advance(3_000)
    await render('2026-10-19T18:30:03Z')
    await advance(2_999)
    expect(details().open).toBe(true)
    await advance(1)
    expect(details().open).toBe(false)
    await render('2026-10-19T18:30:30Z')
    expect(details().open).toBe(false)
  })

  it('does not let an automatic timer close a manual reopening', async () => {
    await render('2026-10-20T04:00:00Z')
    await advance(1_000)
    await act(async () => toggle())
    expect(details().open).toBe(false)
    await act(async () => toggle())
    await advance(10_000)
    expect(details().open).toBe(true)
  })

  it('keeps the notice open when the user focuses the disclosure', async () => {
    await render('2026-10-20T04:00:00Z')
    await act(async () => container.querySelector('summary')!.focus())
    await advance(6_000)
    expect(details().open).toBe(true)
  })

  it('dismisses in Strict Mode and shows each holiday once per browser tab', async () => {
    const date = new Date('2026-10-20T04:00:00Z')
    await act(async () => root.render(<StrictMode><MarketCalendar now={date} /></StrictMode>))
    expect(details().open).toBe(true)
    await advance(6_000)
    expect(details().open).toBe(false)
    await act(async () => root.render(null))
    await render(date.toISOString())
    expect(details().open).toBe(false)
    await render('2026-12-25T04:00:00Z')
    expect(details().open).toBe(true)
    expect(container.querySelector('.market-calendar-holiday')?.textContent).toContain('Christmas')
  })

  it('closes an automatic notice when the holiday ends', async () => {
    await render('2026-10-20T18:29:59Z')
    expect(details().open).toBe(true)
    await render('2026-10-20T18:30:00Z')
    expect(details().open).toBe(false)
    expect(container.querySelector('.market-calendar-holiday')).toBeNull()
    await advance(6_000)
    expect(details().open).toBe(false)
  })

  it('still dismisses on time when session storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable') })
    await render('2026-10-20T04:00:00Z')
    expect(details().open).toBe(true)
    await advance(6_000)
    expect(details().open).toBe(false)
  })
})
