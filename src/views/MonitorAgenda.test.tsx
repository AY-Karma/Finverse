// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MarketEventsFeed } from '../marketEvents'
import type { MonitorController } from '../useMonitor'
import { MonitorAgenda } from './MonitorAgenda'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.mock('../useStore', () => ({ useStore: () => ({ workspaceReadOnly: false, positions: [] }) }))

let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

const controller = { now: Date.UTC(2026, 10, 20), hideValues: false, allowExternalData: true, events: [], positions: [] } as unknown as MonitorController
const render = (feed: MarketEventsFeed) => act(async () => root.render(<MonitorAgenda controller={controller} feed={feed} loading={false} onRemind={() => {}} onOpenHolding={() => {}} onRetry={() => {}} />))

it('states an empty calendar plainly and keeps coverage limits to one line', async () => {
  await render({ events: [], fetchedAt: 1, issues: [
    { source: 'Company events', message: 'Mutual fund notices are not supplied by the NSE equity feed: Fund A.' },
    { source: 'NSE issuer reference', message: 'Some filings may be withheld.' },
  ] })
  expect(container.textContent).toContain('No announced events for your NSE holdings in the next 90 days.')
  expect(container.querySelector('.mp-coverage-line')?.textContent).toContain('Covers NSE-listed stocks and ETFs')
  expect(container.querySelector('details')).toBeNull()
  expect(container.textContent).not.toContain('Fund A')
})

it('offers a retry only when an event source fails', async () => {
  await render({ events: [], fetchedAt: 1, issues: [{ source: 'NSE meetings', message: 'Source unavailable.' }] })
  expect(container.querySelector('details summary')?.textContent).toBe('Event sources unavailable')
  expect(container.textContent).not.toContain('No announced events')
})

it('keeps listing problems that need action visible beside the coverage note', async () => {
  await render({ events: [], fetchedAt: 1, issues: [
    { source: 'Company events', message: 'Mutual fund notices are not supplied by the NSE equity feed: Fund A.' },
    { source: 'Company events', message: 'ISIN mismatch for Acme (ACME): holding INE000000001, NSE INE000000002. These updates were skipped.' },
  ] })
  expect(container.querySelector('.mp-coverage-line')).not.toBeNull()
  expect(container.querySelector('details summary')?.textContent).toBe('Some holdings need attention')
  expect(container.querySelector('details')?.textContent).toContain('ISIN mismatch for Acme')
})
