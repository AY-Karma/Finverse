import { describe, expect, it, vi } from 'vitest'
import { createNewsQueryResolver, searchableIndexName, splitTicker } from '../api/_newsQuery'

const ETF_LIST = [
  'Symbol,Underlying Asset,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue,ETF Underlying,Underlying Key',
  'MON100,Nasdaq100,MotilalOsNASDAQ100ETF,31-Mar-11,1,INF247L01AP3,1,GLOBAL INDICES,GLOBAL INDICES',
  'MOALPHA50,Nifty Alpha 50 Total Return Index,MOTILALAMC - MOALPHA50,10-Jul-25,1,INF247L01FR8,10,EQUITY,Nifty Alpha 50',
  'GOLDBEES,Gold,NIPINDETFGOLDBEES,08-Mar-07,1,INF204KB17I5,1,GOLD,GOLD',
].join('\n')

describe('news search query for holdings', () => {
  it('searches the underlying index for NSE ETF tickers that news never mentions', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(ETF_LIST))
    const resolve = createNewsQueryResolver(fetcher, () => 0)
    expect(await resolve('MON100')).toBe('Nasdaq 100 ETF')
    expect(await resolve('moalpha50')).toBe('Nifty Alpha 50 ETF')
    expect(await resolve('GOLDBEES')).toBe('Gold ETF')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('splits other run-together tickers and leaves names and plain tickers alone', async () => {
    const resolve = createNewsQueryResolver(vi.fn<typeof fetch>(async () => new Response(ETF_LIST)), () => 0)
    expect(await resolve('ABC100')).toBe('ABC 100')
    expect(await resolve('RELIANCE')).toBe('RELIANCE')
    expect(await resolve('Parag Parikh Flexi Cap Fund')).toBe('Parag Parikh Flexi Cap Fund')
  })

  it('falls back to splitting when the NSE ETF list is unavailable', async () => {
    const resolve = createNewsQueryResolver(vi.fn<typeof fetch>(async () => new Response('down', { status: 503 })), () => 0)
    expect(await resolve('MON100')).toBe('MON 100')
  })

  it('cleans index names into searchable phrases', () => {
    expect(searchableIndexName('Nifty Alpha 50 Total Return Index', 'Nifty Alpha 50')).toBe('Nifty Alpha 50')
    expect(searchableIndexName('Hang Seng Index', 'GLOBAL INDICES')).toBe('Hang Seng')
    expect(splitTicker('NIFTY50ETF')).toBe('NIFTY 50 ETF')
  })
})
