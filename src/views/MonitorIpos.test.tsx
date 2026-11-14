// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpoFeed, IpoIssue } from '../ipoProtocol'
import { useIpos } from '../useIpos'
import { cachedIpoGmpHistory, loadIpoGmpHistory } from '../ipoGmpHistory'
import { MonitorIpos } from './MonitorIpos'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
vi.mock('../useIpos', () => ({ useIpos: vi.fn() }))
vi.mock('../ipoGmpHistory', () => ({ cachedIpoGmpHistory: vi.fn(), loadIpoGmpHistory: vi.fn() }))

let root: Root
let container: HTMLDivElement
const refresh = vi.fn()

function issue(id: string, overrides: Partial<IpoIssue> = {}): IpoIssue {
  return {
    id, name: `Company ${id}`, board: 'MAINBOARD', status: 'OPEN',
    openDate: '2026-11-02', closeDate: '2026-11-09', listingDate: null, allotmentDate: null,
    priceMin: 90, priceMax: 100, lotSize: 100,
    sourceUrl: `https://www.xflot.com/ipo/${id}`,
    gmp: null,
    ...overrides,
  }
}

function setFeed(issues: IpoIssue[], overrides: Partial<IpoFeed> = {}) {
  const feed: IpoFeed = {
    issues, fetchedAt: Date.UTC(2026, 10, 7, 12), sources: [
      { name: 'Xflot', url: 'https://www.xflot.com', updatedAt: null },
      { name: 'GMP Today', url: 'https://gmptoday.in', updatedAt: Date.UTC(2026, 10, 7, 12) },
    ], warnings: [], stale: false, ...overrides,
  }
  vi.mocked(useIpos).mockReturnValue({ feed, loading: false, error: null, refresh })
  vi.mocked(Date.now).mockReturnValue(feed.fetchedAt)
}

async function render(allowed = true, props: Omit<Parameters<typeof MonitorIpos>[0], 'allowed'> = {}) {
  await act(async () => { root.render(<MonitorIpos allowed={allowed} {...props} />) })
}

async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => {
      if (candidate.getAttribute('aria-label') === label) return true
      const copy = candidate.cloneNode(true) as HTMLElement
      copy.querySelectorAll('[aria-hidden="true"]').forEach((element) => element.remove())
      return copy.textContent?.trim() === label
    })
  expect(button, `Expected button ${label}`).toBeDefined()
  await act(async () => { button!.click() })
}

function rowButtons() {
  return [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
    .filter((button) => button.getAttribute('aria-label')?.startsWith('View '))
}

function rowText(button: HTMLButtonElement) { return button.closest('.mi-row')!.textContent }
function upcomingRows() { return [...container.querySelectorAll<HTMLElement>('.mi-upcoming-row')] }

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-07T18:29:59Z'))
  vi.mocked(useIpos).mockReset()
  refresh.mockReset()
  vi.mocked(cachedIpoGmpHistory).mockReset().mockReturnValue(null)
  vi.mocked(loadIpoGmpHistory).mockReset().mockImplementation(async (slug) => ({ slug, gmp: null, checkedAt: Date.now() }))
  vi.mocked(useIpos).mockReturnValue({ feed: null, loading: false, error: null, refresh })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.restoreAllMocks()
})

describe('Monitor IPOs', () => {
  it('limits Recent to seven IST calendar dates and excludes older rows from history preparation', async () => {
    const issues = [
      issue('latest', { id: 'xflot:latest', status: 'LISTED', listingDate: '2026-11-07' }),
      issue('boundary', { id: 'xflot:boundary', status: 'LISTED', listingDate: '2026-11-01' }),
      issue('older', { id: 'xflot:older', status: 'LISTED', listingDate: '2026-10-31' }),
    ]
    setFeed(issues, { fetchedAt: Date.parse('2026-11-07T18:29:59Z') })
    await render()
    expect(rowButtons()).toHaveLength(0)
    await click('Recent')
    expect(container.querySelector('.mi-period-scope')?.textContent).toBe('Past 7 days')
    expect(rowButtons().map((row) => row.querySelector('.mi-name')?.textContent)).toEqual(['Company latest', 'Company boundary'])
    expect(loadIpoGmpHistory).not.toHaveBeenCalledWith('older')
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-07T18:30:00Z'))
    await render()
    expect(rowButtons().map((row) => row.querySelector('.mi-name')?.textContent)).toEqual(['Company latest'])
  })

  it('does not apply the Recent cutoff to Open or Upcoming, including unknown dates', async () => {
    setFeed([
      issue('old-open', { openDate: '2026-10-01', closeDate: '2026-10-03' }),
      issue('unknown-open', { openDate: null, closeDate: null }),
      issue('distant-upcoming', { status: 'UPCOMING', openDate: '2027-01-01', closeDate: '2027-01-03' }),
      issue('unknown-upcoming', { status: 'UPCOMING', openDate: null, closeDate: null }),
    ])
    await render()
    expect(rowButtons().map((row) => row.querySelector('.mi-name')?.textContent)).toEqual(['Company old-open', 'Company unknown-open'])
    await click('Upcoming')
    expect(upcomingRows().map((row) => row.querySelector('.mi-name')?.textContent)).toEqual(['Company distant-upcoming', 'Company unknown-upcoming'])
  })

  it('lets Open issues be watched and unwatched and disables editing when read-only', async () => {
    const selected = issue('watchable')
    const onWatch = vi.fn(), onUnwatch = vi.fn()
    setFeed([selected])
    await render(true, { onWatch, onUnwatch })
    await click('View Company watchable IPO details')
    expect(container.textContent).toContain('Overview reminder on 9 Nov')
    await click('Watch last day')
    expect(onWatch).toHaveBeenCalledExactlyOnceWith(selected)
    await render(true, { onWatch, onUnwatch, watchedIds: [selected.id] })
    await click('Stop watching last day')
    expect(onUnwatch).toHaveBeenCalledExactlyOnceWith(selected.id)
    await render(true, { onWatch, onUnwatch, watchReadOnly: true })
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent === 'Watch last day')!
    expect(button.disabled).toBe(true)
    await act(async () => button.click())
    expect(onWatch).toHaveBeenCalledTimes(1)
  })

  it('shows only names and boards for Upcoming without fetching history, including View all', async () => {
    setFeed(['zeta', 'alpha', 'echo', 'delta', 'charlie', 'bravo'].map((id, index) => issue(id, {
      id: `xflot:${id}`, status: 'UPCOMING', board: index % 2 ? 'SME' : 'MAINBOARD',
    })))
    const onWatch = vi.fn()
    await render(true, { onWatch, watchedIds: ['xflot:alpha'] })
    await click('Sort IPOs'); await click('GMP: highest')
    await click('Upcoming')
    expect(container.querySelector('[aria-label="Sort IPOs"]')).toBeNull()
    expect(upcomingRows()).toHaveLength(4)
    await click('View all 6 IPOs')
    expect(upcomingRows().map((row) => row.querySelector('.mi-name')?.textContent)).toEqual([
      'Company alpha', 'Company bravo', 'Company charlie', 'Company delta', 'Company echo', 'Company zeta',
    ])
    for (const row of upcomingRows()) {
      expect(row.querySelector('.mi-meta')?.textContent).toMatch(/^(Mainboard|SME)$/)
      expect(row.querySelector('button, a, .mi-price, .mi-gmp, .mi-trend-trigger, .mi-details')).toBeNull()
      expect(row.textContent).not.toMatch(/GMP|announced|Closes|Opens|Upcoming|9 Nov/)
    }
    expect(loadIpoGmpHistory).not.toHaveBeenCalled()
    expect(onWatch).not.toHaveBeenCalled()
    await click('Open')
    expect(container.querySelector('[aria-label="Sort IPOs"]')).not.toBeNull()
  })

  it('requires an announced closing date and does not offer last-day watches for past IPOs', async () => {
    const onWatch = vi.fn()
    setFeed([issue('unknown-close', { closeDate: null }), issue('past', { status: 'LISTED', listingDate: '2026-11-06' })])
    await render(true, { onWatch })
    await click('View Company unknown-close IPO details')
    expect(container.textContent).toContain('Closing date not announced')
    const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent === 'Watch last day')!
    expect(button.disabled).toBe(true)
    await act(async () => button.click())
    expect(onWatch).not.toHaveBeenCalled()
    await click('Recent')
    await click('View Company past IPO details')
    expect(container.querySelector('.mi-watch-action')).toBeNull()
  })

  it('opens a separate inline chart from the sparkline without overwriting the current quote or nesting buttons', async () => {
    vi.mocked(cachedIpoGmpHistory).mockReturnValue({ slug: 'example', checkedAt: Date.now(), gmp: null,
      points: [{ date: '2026-10-30', amount: 8 }, { date: '2026-10-31', amount: 5 }], sourceUrl: 'https://gmptoday.in/ipo/example/' })
    setFeed([issue('example', { id: 'xflot:example', gmp: { amount: 72, percent: 72, source: 'GMP Today', sourceUrl: 'https://gmptoday.in/ipo/example/', sourceUpdatedAt: null, observedAt: null, sources: null, rangeLow: null, rangeHigh: null } })])
    await render()
    expect(rowText(rowButtons()[0])).toContain('₹72[+72%]')
    expect(container.querySelector('button button')).toBeNull()
    expect(container.querySelector('.mi-sparkline')?.getAttribute('data-tone')).toBe('down')
    await click('Show Company example GMP trend')
    expect(container.querySelector('[aria-label="Company example daily GMP trend"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Company example IPO details"]')).toBeNull()
    expect(container.querySelector('[role="slider"]')?.getAttribute('aria-valuetext')).toContain('₹5.00')
    expect(rowText(rowButtons()[0])).toContain('₹72[+72%]')
    await click('Close Company example GMP trend')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Show Company example GMP trend')
    await click('Show Company example GMP trend')
    await click('Show Company example GMP trend')
    expect(container.querySelector('.mi-trend')).toBeNull()
    await click('Show Company example GMP trend')
    await click('View Company example IPO details')
    expect(container.querySelector('.mi-trend')).toBeNull()
    expect(container.querySelector('[aria-label="Company example IPO details"]')).not.toBeNull()
  })

  it('sorts by the displayed issue date in either direction and leaves unknown dates last', async () => {
    setFeed([
      issue('early', { closeDate: '2026-11-08' }),
      issue('latest', { closeDate: '2026-11-12' }),
      issue('unknown', { closeDate: null, openDate: null }),
      issue('middle', { closeDate: '2026-11-10' }),
    ])
    await render()
    const names = () => rowButtons().map((row) => row.querySelector('.mi-name')!.textContent)
    expect(names()).toEqual(['Company latest', 'Company middle', 'Company early', 'Company unknown'])
    await click('Sort IPOs'); await click('Oldest')
    expect(names()).toEqual(['Company early', 'Company middle', 'Company latest', 'Company unknown'])
    await click('Sort IPOs'); await click('Newest')
    expect(names()[0]).toBe('Company latest')
  })

  it('sorts signed GMP amounts with real zero preserved and missing quotes last', async () => {
    const premium = (amount: number) => ({ amount, percent: amount, source: 'GMP Today' as const, sourceUrl: 'https://gmptoday.in/ipo/example/', sourceUpdatedAt: null, observedAt: null, sources: null, rangeLow: null, rangeHigh: null })
    setFeed([issue('missing'), issue('zero', { gmp: premium(0) }), issue('negative', { gmp: premium(-5) }), issue('positive', { gmp: premium(80) })])
    await render()
    const names = () => rowButtons().map((row) => row.querySelector('.mi-name')!.textContent)
    await click('Sort IPOs'); await click('GMP: highest')
    expect(names()).toEqual(['Company positive', 'Company zero', 'Company negative', 'Company missing'])
    await click('Sort IPOs'); await click('GMP: lowest')
    expect(names()).toEqual(['Company negative', 'Company zero', 'Company positive', 'Company missing'])
    expect(rowText(rowButtons()[1])).toContain('₹0')
  })

  it('includes historical GMP beyond the initial four rows when ranking the full recent list', async () => {
    vi.mocked(loadIpoGmpHistory).mockImplementation(async (slug) => ({ slug, checkedAt: Date.now(), gmp: {
      amount: slug === 'listed-4' ? 80 : 1, percent: slug === 'listed-4' ? 80 : 1,
      source: 'GMP Today', sourceUrl: `https://gmptoday.in/ipo/${slug}/`, asOfDate: '2026-11-01',
      sourceUpdatedAt: null, observedAt: null, sources: null, rangeLow: null, rangeHigh: null,
    } }))
    setFeed(Array.from({ length: 5 }, (_, index) => issue(`listed-${index}`, {
      id: `xflot:listed-${index}`, status: 'LISTED', openDate: '2026-10-15', listingDate: `2026-11-0${6 - index}`,
    })))
    await render()
    await click('Recent')
    expect(loadIpoGmpHistory).not.toHaveBeenCalledWith('listed-4')
    await click('Sort IPOs'); await click('GMP: highest')
    expect(loadIpoGmpHistory).toHaveBeenCalledWith('listed-4')
    expect(rowButtons()).toHaveLength(4)
    expect(rowButtons()[0].querySelector('.mi-name')?.textContent).toBe('Company listed-4')
    expect(rowText(rowButtons()[0])).toContain('As of 1 Nov')
    await click('View Company listed-4 IPO details')
    expect(container.querySelector('[aria-label="Company listed-4 IPO details"]')?.textContent).toContain('Historical GMP')
  })

  it('respects external-data settings and hides previously loaded rows when disabled', async () => {
    setFeed([issue('saved')])
    await render()
    expect(rowButtons()).toHaveLength(1)
    await render(false)
    expect(vi.mocked(useIpos).mock.calls.slice(-1)[0]?.[0]).toBe(false)
    expect(rowButtons()).toHaveLength(0)
    expect(container.querySelector('a[href="/app/settings"]')).toBeNull()
    expect(container.textContent).toContain('Market data is paused')
    expect(container.textContent).toContain('Reload workspace')
  })

  it('keeps lifecycle and board filters independent and limits the default list', async () => {
    setFeed([
      ...Array.from({ length: 6 }, (_, index) => issue(`open-${index}`)),
      issue('sme-open', { board: 'SME' }),
      issue('future', { status: 'UPCOMING', openDate: '2026-11-16', closeDate: '2026-11-18' }),
      issue('listed', { status: 'LISTED', listingDate: '2026-11-06' }),
    ])
    await render()
    expect(rowButtons()).toHaveLength(4)
    await click('View all 7 IPOs')
    expect(rowButtons()).toHaveLength(7)
    await click('Show less')
    expect(rowButtons()).toHaveLength(4)

    await click('IPO board')
    const options = () => [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    await act(async () => { options().find((option) => option.textContent === 'SME')!.click() })
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector('[aria-label="IPO board"]'))
    expect(rowButtons()).toHaveLength(1)
    expect(rowButtons()[0].getAttribute('aria-label')).toContain('Company sme-open')
    await click('Upcoming')
    expect(upcomingRows()).toHaveLength(0)
    await click('IPO board')
    await act(async () => { options().find((option) => option.textContent === 'All boards')!.click() })
    expect(upcomingRows()).toHaveLength(1)
    expect(upcomingRows()[0].querySelector('.mi-name')?.textContent).toBe('Company future')
  })

  it('supports keyboard navigation and dismisses the board menu without changing the filter', async () => {
    setFeed([issue('main'), issue('sme', { board: 'SME' })])
    await render()
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="IPO board"]')!
    const key = async (value: string) => act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))
    })
    trigger.focus()
    await key('ArrowDown')
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true')
    await key('End')
    expect(document.activeElement?.textContent).toBe('SME')
    await key('Escape')
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(rowButtons()).toHaveLength(2)
    await click('IPO board')
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps Open selected when none are open and lets the user choose Upcoming', async () => {
    setFeed([
      issue('closed', { status: 'CLOSED' }),
      issue('next', { status: 'UPCOMING', openDate: null, closeDate: null }),
    ])
    await render()
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Open')
    expect(rowButtons()).toHaveLength(0)
    expect(container.textContent).toContain('No IPOs open for bidding right now.')
    await click('Upcoming')
    expect(upcomingRows()).toHaveLength(1)
    expect(upcomingRows()[0].querySelector('.mi-name')?.textContent).toBe('Company next')
  })

  it('offers a board-specific recent count from the empty view and keeps attribution grouped', async () => {
    setFeed([
      issue('recent-a', { status: 'CLOSED', closeDate: '2026-11-06' }),
      issue('recent-b', { status: 'CLOSED', closeDate: '2026-11-05' }),
      issue('recent-sme', { board: 'SME', status: 'CLOSED', closeDate: '2026-11-04' }),
    ])
    await render()
    await click('Open')
    expect(container.querySelector('.mi-empty-action')?.textContent).toBe('Browse recent3 IPOs')
    await click('IPO board')
    await act(async () => { container.querySelectorAll<HTMLButtonElement>('[role="option"]')[1].click() })
    expect(container.querySelector('.mi-empty-action')?.textContent).toBe('Browse recent2 IPOs')
    await click('Browse recent2 IPOs')
    expect(rowButtons()).toHaveLength(2)
    const sources = container.querySelector('.mi-source-line')!
    expect(sources.textContent).toContain('Xflot')
    expect(sources.querySelectorAll('a')).toHaveLength(2)
    expect(container.querySelector<HTMLTimeElement>('.mi-source-time time')?.dateTime).toBe('2026-11-07T12:00:00.000Z')
    const disclaimer = container.querySelector<HTMLElement>('.mi-disclaimer')!
    expect(disclaimer.tagName).toBe('DETAILS')
    expect(disclaimer.hidden).toBe(false)
    expect(disclaimer.textContent).toContain('Source-page updates are not dealer quote times.')
    expect(container.querySelector('.mi-data-notes-toggle')).toBeNull()
  })

  it('keeps Open selected rather than switching to recent or unknown-only upcoming rows', async () => {
    setFeed([
      issue('recent', { status: 'CLOSED', closeDate: '2026-11-06' }),
      issue('unannounced', { status: 'UPCOMING', openDate: null, closeDate: null, priceMin: null, priceMax: null }),
    ])
    await render()
    expect(rowButtons()).toHaveLength(0)
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Open')
    await click('Recent')
    expect(rowButtons()).toHaveLength(1)
    expect(rowButtons()[0].getAttribute('aria-label')).toContain('Company recent')
    expect([...container.querySelectorAll('button[aria-pressed="true"]')].map((button) => button.textContent)).toContain('Recent')
    await click('Upcoming')
    expect(upcomingRows()).toHaveLength(1)
    expect(upcomingRows()[0].querySelector('.mi-name')?.textContent).toBe('Company unannounced')
    expect(upcomingRows()[0].textContent).toBe('Company unannouncedMainboard')
  })

  it('discloses the grouped publisher disclaimer with an alert triangle and closes on repeat click', async () => {
    const disclaimerText = 'Aggregated public information. GMP is unofficial and not published by any exchange or regulator. Nothing here is investment advice.'
    const warnings = ['Omitted 45 issues with conflicting source records.', 'Reported GMP could not be refreshed.']
    setFeed([issue('one')], { disclaimer: disclaimerText, warnings, stale: true })
    await render()
    const disclaimer = container.querySelector<HTMLElement>('.mi-disclaimer')!
    const heading = disclaimer.querySelector('h3')!
    expect(heading.textContent).toBe('Disclaimer')
    expect(disclaimer.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(disclaimer.hasAttribute('open')).toBe(false)
    const summary = disclaimer.querySelector('summary')!
    expect(summary.querySelector('.action-icon')).not.toBeNull()
    await act(async () => summary.click())
    expect(disclaimer.hasAttribute('open')).toBe(true)
    await act(async () => summary.click())
    expect(disclaimer.hasAttribute('open')).toBe(false)
    expect([...disclaimer.querySelectorAll('p')].some((paragraph) => paragraph.textContent === disclaimerText)).toBe(true)
    expect([...disclaimer.querySelectorAll('h4')].map((element) => element.textContent)).toEqual(['Data sources', 'Updates', 'Coverage'])
    const links = [...disclaimer.querySelectorAll<HTMLAnchorElement>('a')]
    expect(links.map((link) => link.href)).toEqual(['https://www.xflot.com/', 'https://gmptoday.in/'])
    expect(links.every((link) => link.target === '_blank' && link.rel.includes('noopener'))).toBe(true)
    expect(disclaimer.textContent).toContain('GMP page updated')
    expect(disclaimer.textContent).toContain('IPO list checked')
    expect(disclaimer.querySelectorAll('time')).toHaveLength(2)
    expect(disclaimer.textContent).toContain('Source-page updates are not dealer quote times.')
    for (const warning of warnings) expect(disclaimer.textContent).toContain(warning)
    expect(disclaimer.textContent).toContain('Some sources are dated or could not be refreshed.')
    expect(disclaimer.closest('[role="alert"]')).toBeNull()
    expect(disclaimer.querySelector('[role="alert"]')).toBeNull()
  })

  it('opens details beside their issue and closes them on a repeated click', async () => {
    setFeed([issue('one'), issue('two')])
    await render()
    await click('View Company one IPO details')
    const region = container.querySelector<HTMLElement>('[role="region"][aria-label="Company one IPO details"]')
    expect(region).not.toBeNull()
    expect(rowButtons()[0].getAttribute('aria-expanded')).toBe('true')
    expect(region!.textContent).toContain('100')
    const researchLinks = [...region!.querySelectorAll<HTMLAnchorElement>('.mi-links a')]
    expect(researchLinks.map((link) => link.href)).toEqual([
      'https://www.investorgain.com/report/ipo-gmp-live/331/',
      'https://www.chittorgarh.com/',
    ])
    expect(researchLinks.every((link) => link.target === '_blank' && link.rel.includes('noopener') && link.rel.includes('noreferrer'))).toBe(true)
    expect(region!.querySelector('.mi-issue-source')?.getAttribute('href')).toBe('https://www.xflot.com/ipo/one')
    expect(region!.querySelectorAll('.mi-timeline li')).toHaveLength(2)
    expect(region!.querySelector('.mi-timeline')!.textContent).not.toContain('not announced')
    expect(region!.textContent).toContain('Allotment / listing dates unavailable')
    await click('View Company one IPO details')
    expect(container.querySelector('[role="region"][aria-label="Company one IPO details"]')).toBeNull()
    expect(rowButtons()[0].getAttribute('aria-expanded')).toBe('false')
  })

  it('distinguishes a reported zero premium from missing GMP', async () => {
    setFeed([
      issue('zero', { gmp: {
        amount: 0, percent: 0, source: 'GMP Today', sourceUrl: 'https://gmptoday.in/ipo/zero/',
        sourceUpdatedAt: Date.UTC(2026, 10, 7, 12), observedAt: null,
        sources: 2, rangeLow: 0, rangeHigh: 0,
      } }),
      issue('unknown'),
    ])
    await render()
    const zero = rowButtons().find((button) => button.getAttribute('aria-label') === 'View Company zero IPO details')!
    const unknown = rowButtons().find((button) => button.getAttribute('aria-label') === 'View Company unknown IPO details')!
    expect(rowText(zero)).toMatch(/₹\s*0/)
    expect(rowText(zero)).not.toContain('Not reported')
    expect(rowText(unknown)).toContain('Not reported')
    expect(container.textContent).toMatch(/unofficial/i)
    expect(container.querySelector('a[href="https://gmptoday.in/"]')).not.toBeNull()
    await click('View Company zero IPO details')
    const region = container.querySelector<HTMLElement>('[role="region"][aria-label="Company zero IPO details"]')!
    expect(region.textContent).toContain('Page updated')
    expect(region.textContent).toContain('Quote time unavailable')
    expect(region.textContent).not.toContain('Reported 7 Nov')
  })

  it('keeps unavailable milestones concise instead of creating empty timeline stages', async () => {
    setFeed([issue('unknown-dates', { openDate: null, closeDate: null, allotmentDate: null, listingDate: null })])
    await render()
    await click('View Company unknown-dates IPO details')
    const region = container.querySelector<HTMLElement>('[role="region"][aria-label="Company unknown-dates IPO details"]')!
    expect(region.querySelector('.mi-timeline')).toBeNull()
    expect(region.querySelectorAll('.mi-unannounced')).toHaveLength(1)
    expect(region.textContent).toContain('Allotment / listing dates unavailable')
  })

  it('offers a retry when the first request fails', async () => {
    vi.mocked(useIpos).mockReturnValue({ feed: null, loading: false, error: 'IPOs could not be loaded.', refresh })
    await render()
    expect(container.textContent).toContain('IPOs could not be loaded.')
    expect(rowButtons()).toHaveLength(0)
    await click('Try again')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps saved rows readable when the latest refresh fails', async () => {
    setFeed([issue('cached')], { stale: true, warnings: ['The upstream source is unavailable.'] })
    await render()
    expect(rowButtons()).toHaveLength(1)
    const notice = container.querySelector('[role="status"]')!
    expect(notice.textContent).toContain('Saved data may be out of date')
    expect(notice.closest('details')).toBeNull()
    expect(container.querySelector('.mi-loading')).toBeNull()
    await click('Refresh IPOs')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('makes partial coverage visible before the user opens source details', async () => {
    setFeed([issue('partial')], { warnings: ['Omitted conflicting issue records.'] })
    await render()
    const notice = container.querySelector('[role="status"]')!
    expect(notice.textContent).toContain('Limited coverage')
    expect(notice.textContent).toContain('Unofficial GMP')
    expect(notice.closest('details')).toBeNull()
    expect(container.querySelector('.mi-source-time')!.textContent).toContain('GMP page updated')
  })

  it('identifies listed-issue GMP as a historical pre-listing quote', async () => {
    setFeed([issue('listed', { status: 'LISTED', listingDate: '2026-11-06', gmp: {
      amount: -5, percent: -5, source: 'Xflot', sourceUrl: 'https://www.xflot.com/ipo/listed',
      sourceUpdatedAt: null, observedAt: Date.UTC(2026, 10, 5, 12),
      sources: null, rangeLow: null, rangeHigh: null,
    } })])
    await render()
    await click('Recent')
    await click('View Company listed IPO details')
    const region = container.querySelector<HTMLElement>('[role="region"][aria-label="Company listed IPO details"]')!
    expect(region.textContent).toContain('Historical GMP')
    expect(region.textContent).toContain('Pre-listing quote, not the listed stock price.')
    expect(region.textContent).toContain('Reported')
    expect(region.textContent).not.toContain('Source updated')
  })

  it('loads dated history separately without blocking issue facts or inventing a quote time', async () => {
    let finish!: (value: Awaited<ReturnType<typeof loadIpoGmpHistory>>) => void
    vi.mocked(loadIpoGmpHistory).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    setFeed([issue('bonfiglioli', { id: 'xflot:bonfiglioli-ipo', status: 'LISTED', openDate: '2026-10-15', closeDate: '2026-10-19', listingDate: '2026-10-23' })], { fetchedAt: Date.UTC(2026, 9, 25, 12) })
    await render()
    await click('Recent')
    expect(rowButtons()).toHaveLength(1)
    expect(rowText(rowButtons()[0])).toContain('Loading history')
    expect(rowText(rowButtons()[0])).toContain('Listed 23 Oct')
    await act(async () => { finish({ slug: 'bonfiglioli-ipo', checkedAt: Date.now(), gmp: {
      amount: 80, percent: 80, source: 'GMP Today', sourceUrl: 'https://gmptoday.in/ipo/bonfiglioli-transmissions/',
      observedAt: null, sourceUpdatedAt: null, asOfDate: '2026-10-22', sources: 3, rangeLow: 75, rangeHigh: 85,
    } }) })
    expect(rowText(rowButtons()[0])).toContain('As of 22 Oct')
    expect(rowText(rowButtons()[0])).toMatch(/₹\s*80/)
    await click('View Company bonfiglioli IPO details')
    const details = container.querySelector('[aria-label="Company bonfiglioli IPO details"]')!
    expect(details.textContent).toContain('Daily reported GMP')
    expect(details.textContent).not.toContain('05:30')
    expect(details.querySelector('a[href="https://gmptoday.in/ipo/bonfiglioli-transmissions/"]')).not.toBeNull()
  })

  it('prepares trend data for every visible row when a long recent list is expanded', async () => {
    vi.mocked(loadIpoGmpHistory).mockImplementation(async (slug) => ({ slug, checkedAt: Date.now(), gmp: null,
      points: [{ date: '2026-11-03', amount: 10 }, { date: '2026-11-04', amount: 12 }], sourceUrl: `https://gmptoday.in/ipo/${slug}/` }))
    setFeed(Array.from({ length: 10 }, (_, index) => issue(`listed-${index}`, { id: `xflot:listed-${index}`, status: 'LISTED', listingDate: '2026-11-06' })))
    await render()
    await click('Recent')
    expect(new Set(vi.mocked(loadIpoGmpHistory).mock.calls.map(([slug]) => slug)).size).toBe(4)
    expect(container.querySelectorAll('.mi-sparkline')).toHaveLength(4)
    await click('View all 10 IPOs')
    expect(rowButtons()).toHaveLength(10)
    expect(new Set(vi.mocked(loadIpoGmpHistory).mock.calls.map(([slug]) => slug)).size).toBe(10)
    expect(container.querySelectorAll('.mi-sparkline')).toHaveLength(10)
    expect(rowText(rowButtons()[0])).toContain('History unavailable')
    expect(rowText(rowButtons()[9])).toContain('History unavailable')
  })

  it('offers a scoped retry for failed historical retrieval', async () => {
    vi.mocked(loadIpoGmpHistory).mockRejectedValueOnce(new Error('Offline'))
    setFeed([issue('listed', { id: 'xflot:listed', status: 'LISTED', listingDate: '2026-11-06' })])
    await render()
    await click('Recent')
    expect(rowText(rowButtons()[0])).toContain('History unavailable')
    await click('View Company listed IPO details')
    expect(container.textContent).toContain('Historical GMP could not be loaded')
    await click('Try again')
    expect(loadIpoGmpHistory).toHaveBeenLastCalledWith('listed', true)
  })

  it.each([
    { reason: 'another offer window', asOfDate: '2025-10-22', percent: 80 },
    { reason: 'another issue price', asOfDate: '2026-10-22', percent: 20 },
  ])('does not attach cached history from $reason', async ({ asOfDate, percent }) => {
    vi.mocked(cachedIpoGmpHistory).mockReturnValue({ slug: 'listed', checkedAt: Date.now(), gmp: {
      source: 'GMP Today', sourceUrl: 'https://gmptoday.in/ipo/listed/', amount: 80, percent,
      asOfDate, observedAt: null, sourceUpdatedAt: null, sources: 2, rangeLow: 75, rangeHigh: 85,
    } })
    setFeed([issue('listed', { id: 'xflot:listed', status: 'LISTED', openDate: '2026-10-15', closeDate: '2026-10-19', listingDate: '2026-10-23' })], { fetchedAt: Date.UTC(2026, 9, 25, 12) })
    await render()
    await click('Recent')
    expect(rowText(rowButtons()[0])).toContain('History unavailable')
    expect(rowText(rowButtons()[0])).not.toContain('As of 22 Oct')
  })
})

