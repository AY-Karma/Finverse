// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { DataHealthGuide } from './DataHealthGuide'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined
let container: HTMLDivElement

async function renderGuide(healthLabel: string, allowExternalData = true) {
  container = document.createElement('div')
  root = createRoot(container)
  await act(async () => root!.render(<DataHealthGuide healthLabel={healthLabel} allowExternalData={allowExternalData} />))
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
})

it('explains all five labels and identifies only the current status', async () => {
  await renderGuide('Partial quotes')
  const rows = [...container.querySelectorAll('li')]
  expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual([
    'Quoted', 'Older quotes', 'Partial quotes', 'Imported only', 'No prices',
  ])
  expect(rows.every((row) => row.textContent?.includes('Meaning') && row.textContent.includes('What to do'))).toBe(true)
  expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  expect(container.querySelector('[aria-current="true"]')?.textContent).toContain('Partial quotesCurrent status')
})

it('distinguishes closing prices, old quotes and imported price freshness', async () => {
  await renderGuide('Older quotes')
  expect(container.textContent).toContain('not real-time quotes')
  expect(container.textContent).toContain('at least one is over 24 hours old')
  expect(container.textContent).toContain('Wait for the next trading session or NAV update')
  expect(container.textContent).toContain('cannot tell when those prices were last updated')
  expect(container.textContent).toContain('review its ticker, exchange or fund identifier in your import file')
})

it('directs users with external data off to Settings or recent imported prices', async () => {
  await renderGuide('Imported only', false)
  expect(container.querySelector('.data-health-guide-off')?.textContent).toContain('External market data is off')
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/app/settings')
  const current = container.querySelector('[aria-current="true"]')
  expect(current?.textContent).toContain('Import a recent holdings file with last prices')
  expect(current?.textContent).toContain('enable External market data in Settings > Data & privacy')
})
