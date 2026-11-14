// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IpoGmpHistoryResponse } from './ipoGmpHistoryProtocol'
import type { IpoIssue } from './ipoProtocol'
import { cachedIpoGmpHistory, loadIpoGmpHistory } from './ipoGmpHistory'
import { ipoHistorySlug, ipoTrendSlug, useIpoGmpHistory } from './useIpoGmpHistory'

vi.mock('./ipoGmpHistory', () => ({ cachedIpoGmpHistory: vi.fn(), loadIpoGmpHistory: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const NOW = Date.parse('2026-11-08T06:00:00Z')
const quote = { amount: 1, percent: 1, source: 'GMP Today' as const, sourceUrl: 'https://gmptoday.in/ipo/example/', observedAt: null, sourceUpdatedAt: null, asOfDate: '2026-11-07', sources: 2, rangeLow: 1, rangeHigh: 1 }
const issue = (id = 'example', overrides: Partial<IpoIssue> = {}): IpoIssue => ({
  id: `xflot:${id}`, name: id, board: 'MAINBOARD', status: 'UPCOMING', openDate: '2026-11-10', closeDate: '2026-11-12', listingDate: '2026-11-17', allotmentDate: null,
  priceMin: 90, priceMax: 100, lotSize: 100, sourceUrl: `https://www.xflot.com/ipo/${id}`, gmp: { ...quote, amount: 3, percent: 3 }, ...overrides,
})
const reply = (slug = 'example', overrides: Partial<IpoGmpHistoryResponse> = {}): IpoGmpHistoryResponse => ({ slug, checkedAt: NOW, gmp: quote,
  points: [{ date: '2026-11-05', amount: -2 }, { date: '2026-11-06', amount: 0 }, { date: '2026-11-07', amount: 1 }], sourceUrl: quote.sourceUrl, sourceUpdatedAt: null, ...overrides })

let root: Root, issues: IpoIssue[], allowed: boolean, renders: number, openedIssue: string
let result: ReturnType<typeof useIpoGmpHistory>
function Capture() { result = useIpoGmpHistory(issues, allowed, openedIssue); renders++; return null }
const render = () => act(async () => root.render(<Capture />))

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW)
  vi.mocked(cachedIpoGmpHistory).mockReset().mockReturnValue(null)
  vi.mocked(loadIpoGmpHistory).mockReset().mockImplementation(async (slug) => reply(slug))
  issues = [issue()]; allowed = true; renders = 0; openedIssue = ''
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers() })

it('rechecks history when an IPO opens after the cached series has aged', async () => {
  await render()
  expect(loadIpoGmpHistory).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(60 * 60_000)
  vi.mocked(loadIpoGmpHistory).mockResolvedValue(reply('example', { points: [{ date: '2026-11-08', amount: 2 }] }))
  openedIssue = 'example'
  await render()
  expect(loadIpoGmpHistory).toHaveBeenCalledTimes(2)
  expect(result.histories.example.points).toEqual([{ date: '2026-11-08', amount: 2 }])
  expect(issues[0].gmp?.amount).toBe(3)
})

it('retains the loaded series with an error state when an expired recheck fails', async () => {
  await render()
  const previous = result.histories.example.points
  vi.advanceTimersByTime(60 * 60_000)
  vi.mocked(loadIpoGmpHistory).mockRejectedValue(new Error('Offline'))
  openedIssue = 'example'
  await render()
  expect(result.histories.example.status).toBe('error')
  expect(result.histories.example.points).toEqual(previous)
})

it('loads active quoted issues and exposes genuine pre-opening history without replacing their quote', async () => {
  expect(ipoHistorySlug(issues[0])).toBeNull()
  expect(ipoTrendSlug(issues[0])).toBe('example')
  await render()
  expect(loadIpoGmpHistory).toHaveBeenCalledWith('example')
  expect(result.histories.example.points).toEqual(reply().points)
  expect(result.histories.example.gmp).toBeNull()
  expect(issues[0].gmp?.amount).toBe(3)
  expect(result.histories.example.sourceUrl).toBe(quote.sourceUrl)
})

it('does not request trends without permission or for unsupported identities', async () => {
  allowed = false; await render()
  expect(loadIpoGmpHistory).not.toHaveBeenCalled()
  expect(result.histories).toEqual({})
  allowed = true; issues = [issue('bad', { id: 'xflot:../other' }), issue('other', { id: 'other:example' })]
  await render()
  expect(loadIpoGmpHistory).not.toHaveBeenCalled()
})

it('suppresses future and post-listing samples and rejects a history attached to different offer pricing', async () => {
  issues = [issue('example', { status: 'LISTED', listingDate: '2026-11-07', openDate: '2026-11-01', gmp: null })]
  vi.mocked(loadIpoGmpHistory).mockResolvedValue(reply('example', { gmp: null, points: [
    { date: '2026-11-05', amount: -2 }, { date: '2026-11-07', amount: 5 }, { date: '2026-11-09', amount: 6 },
  ] }))
  await render()
  expect(result.histories.example.points).toEqual([{ date: '2026-11-05', amount: -2 }])
  issues = [issue('different', { priceMax: 200 })]
  await render()
  vi.mocked(cachedIpoGmpHistory).mockReturnValue(reply('different'))
  await render()
  expect(result.histories.different.points).toEqual([])
})

it('ignores a pending retry after its issue leaves the selected context', async () => {
  vi.mocked(loadIpoGmpHistory).mockRejectedValueOnce(new Error('Offline'))
  await render()
  expect(result.histories.example.status).toBe('error')
  let finish!: (value: IpoGmpHistoryResponse) => void
  vi.mocked(loadIpoGmpHistory).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await act(async () => result.retry('example'))
  issues = [issue('second')]; await render()
  const before = renders
  await act(async () => finish(reply()))
  expect(renders).toBe(before)
  expect(Object.keys(result.histories)).toEqual(['second'])
})

it('retains loaded observations while retrying and when the refresh fails', async () => {
  await render()
  vi.mocked(loadIpoGmpHistory).mockRejectedValueOnce(new Error('Offline'))
  await act(async () => result.retry('example'))
  expect(result.histories.example.status).toBe('error')
  expect(result.histories.example.points).toEqual(reply().points)
})

it('uses two workers and stops queued requests after external data is disabled', async () => {
  const pending: ((value: IpoGmpHistoryResponse) => void)[] = []
  vi.mocked(loadIpoGmpHistory).mockImplementation(() => new Promise((resolve) => pending.push(resolve)))
  issues = Array.from({ length: 5 }, (_, index) => issue(`example-${index}`))
  await render()
  expect(loadIpoGmpHistory).toHaveBeenCalledTimes(2)
  allowed = false; await render()
  await act(async () => { pending.forEach((finish, index) => finish(reply(`example-${index}`))) })
  expect(loadIpoGmpHistory).toHaveBeenCalledTimes(2)
  expect(result.histories).toEqual({})
})
