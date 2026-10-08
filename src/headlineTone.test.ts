import { describe, expect, it } from 'vitest'
import { classifyHeadline, type HeadlineTone } from './headlineTone'

describe('estimated headline tone', () => {
  it.each<[string, HeadlineTone]>([
    ['TCS shares surge despite weak earnings', 'positive'],
    ['Shares fall after profit beats expectations', 'negative'],
    ['Revenue rises but profits miss estimates', 'negative'],
    ['Profits beat estimates despite falling revenue', 'positive'],
    ['Losses narrow after interest costs fall', 'positive'],
    ['Losses widen as expenses rise', 'negative'],
    ['Inflation falls to a five-year low', 'positive'],
    ['Unemployment rises to a record high', 'negative'],
    ['Company cuts costs as margins improve', 'positive'],
    ['Company cuts jobs as demand falls', 'negative'],
    ['Profits rise and falling costs boost margins', 'positive'],
    ['Profits grow from a low base', 'positive'],
    ['Nifty ends in the red as Sensex sheds 300 points', 'negative'],
    ['Sensex closes in the green as stocks advance', 'positive'],
    ['Gold prices surge 2% as demand rises', 'positive'],
    ['Sensex stocks hit 52-week lows and slipped up to 12% in a month', 'negative'],
    ['Mastek shares defy weak markets, gain 3% after a deal', 'positive'],
    ['Housing sales may take a hit on higher mortgage rates', 'negative'],
    ['India bonds hemmed in as market digests higher rates', 'negative'],
    ['Company shares rise on low volumes', 'positive'],
    ['Citi revenue nearly doubles as bank raises $16 billion', 'positive'],
    ['Jefferies cuts target prices for BSE and other stocks', 'negative'],
    ['Company declares an interim dividend of Rs 12 per share', 'positive'],
    ['Company announces dividend cuts', 'negative'],
    ['Inflation and AI emerge as key risks for global growth', 'negative'],
    ['Emerging markets see first foreign outflow since June', 'negative'],
    ['Infosys, ITC top gainers and losers on Nifty', 'mixed'],
    ['Company wins a Rs 500 crore contract', 'positive'],
    ['Company wins a Rs. 500 crore contract', 'positive'],
    ["Cupid shares jump 4% in 2026. What's driving the rally?", 'positive'],
    ['Stocks turned multibaggers after crashing 40% last year', 'mixed'],
    ['Company raises full-year guidance', 'positive'],
    ['Broker downgrades TCS after quarterly results', 'negative'],
    ['Company files for bankruptcy after debt defaults', 'negative'],
    ['Court dismisses fraud charges against company', 'positive'],
    ['TCS shares rise, Infosys shares fall', 'mixed'],
    ['Revenue rises but profit falls', 'mixed'],
    ['Shares fell 3% and then recovered 2%', 'mixed'],
    ['Company does not expect profit to fall', 'unknown'],
    ['Company denies fraud allegations', 'unknown'],
    ['Company did not beat estimates', 'unknown'],
    ["RBI halts rupee's slide to a record low", 'unknown'],
    ['Shares could rise after the announcement', 'unknown'],
    ['Will stocks crash after the election?', 'unknown'],
    ['Company appoints a new director', 'unknown'],
    ['Rs 9,395 crore block deal announced', 'unknown'],
    ['Shares rise while profits could fall', 'positive'],
  ])('%s → %s', (title, expected) => {
    expect(classifyHeadline(title).status).toBe(expected)
  })

  it('explains the decisive evidence and both sides of a mixed headline', () => {
    expect(classifyHeadline('Shares gain 2% as costs fall').reason).toContain('shares gain')
    const mixed = classifyHeadline('Revenue rises but profit falls')
    expect(mixed.reason).toContain('revenue rises')
    expect(mixed.reason).toContain('profit falls')
  })
})
