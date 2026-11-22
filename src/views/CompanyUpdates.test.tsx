// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MarketEventsFeed } from '../marketEvents'
import type { MonitorController } from '../useMonitor'
import { CompanyUpdates } from './CompanyUpdates'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.mock('../useStore', () => ({ useStore: () => ({ workspaceReadOnly: false, positions: [] }) }))

let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

const controller = { now: Date.UTC(2026, 10, 20), hideValues: false, allowExternalData: true, events: [], positions: [] } as unknown as MonitorController
const render = (feed: MarketEventsFeed, pending = false) => act(async () => root.render(<CompanyUpdates controller={controller} feed={feed} loading={false} pending={pending} onRemind={() => {}} onOpenHolding={() => {}} onRetry={() => {}} />))

it('states an empty result plainly and keeps coverage limits to one line', async () => {
  await render({ events: [], fetchedAt: 1, issues: [
    { source: 'Company events', message: 'Mutual fund notices are not supplied by the NSE equity feed: Fund A.' },
    { source: 'NSE issuer reference', message: 'Some filings may be withheld.' },
  ] })
  expect(container.textContent).toContain('No announced events or recent filings for your NSE holdings.')
  expect(container.querySelector('.mp-coverage-line')?.textContent).toContain('Covers NSE-listed stocks and ETFs')
  expect(container.querySelector('details')).toBeNull()
  expect(container.textContent).not.toContain('Fund A')
})

it('offers a retry only when a source fails, without claiming an empty result', async () => {
  await render({ events: [], fetchedAt: 1, issues: [{ source: 'NSE meetings', message: 'Source unavailable.' }] })
  expect(container.querySelector('details summary')?.textContent).toBe('Company sources unavailable')
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

it('shows one loader for the whole tab while events are pending', async () => {
  await render({ events: [], fetchedAt: 0, issues: [] }, true)
  expect(container.querySelectorAll('[role="status"][aria-label="Loading company updates"]')).toHaveLength(1)
  expect(container.textContent).not.toContain('No announced events')
})
