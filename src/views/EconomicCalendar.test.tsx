// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let container: HTMLDivElement
const now = Date.parse('2026-11-22T06:00:00Z')
beforeEach(() => { vi.resetModules(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

async function render(response: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(response))
  const { EconomicCalendar } = await import('./EconomicCalendar')
  await act(async () => root.render(<EconomicCalendar allowed now={now} followedDays={[]} onToggleDay={() => {}} />))
}

it('holds a loader until the weekly feed arrives, then groups global and scheduled events by IST day', async () => {
  let finish: (response: Response) => void = () => {}
  await render(() => new Promise((resolve) => { finish = resolve }))
  expect(container.querySelector('[aria-label="Loading economic calendar"]')).not.toBeNull()
  expect(container.querySelector('.mc-row')).toBeNull()
  await act(async () => finish(Response.json({ events: [{ id: 'pce', title: 'Core PCE Price Index m/m', region: 'US', at: '2026-11-25T13:30:00.000Z', allDay: false, forecast: '0.3%', previous: '0.3%', source: 'Forex Factory', sourceUrl: 'https://www.forexfactory.com/calendar' }], fetchedAt: '2026-11-22T06:00:00Z' })))
  const labels = [...container.querySelectorAll('.mc-group-label')].map((label) => label.textContent)
  expect(labels[0]).toBe('Wed, 25 Nov')
  const pce = [...container.querySelectorAll('.mc-row')].find((row) => row.textContent?.includes('Core PCE'))!
  expect(pce.querySelector('.mc-when')?.textContent).toMatch(/7:00\s?pm/i)
  expect(pce.querySelector('.mc-figures')?.textContent).toBe('Fcst 0.3%Prev 0.3%')
  expect(container.textContent).toContain('RBI monetary policy decision')
  expect(container.querySelector('.mc-note')).toBeNull()
})

it('keeps the official schedule and says so when global releases are unavailable', async () => {
  await render(async () => new Response('', { status: 502 }))
  expect(container.querySelector('.mc-note')?.textContent).toContain('Global releases are unavailable')
  expect(container.textContent).toContain('India GDP, Q2 FY 2026-27')
})
