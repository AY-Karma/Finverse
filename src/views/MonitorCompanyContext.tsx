import { useEffect, useRef, useState } from 'react'
import { freshQuote, usableQuote } from '../monitor'
import { eligibleHoldings } from '../marketNews'
import { MAX_NEWS_FOLLOWS } from '../monitorReading'
import { hasSupportedValuationCurrency } from '../valuation'
import type { LiveQuote, Position } from '../types'
import type { MarketEvent } from '../marketEvents'
import type { MonitorController } from '../useMonitor'

type Props = { position: Position; quote?: LiveQuote; controller: MonitorController; events: MarketEvent[]; onClose: () => void; onWatch: () => void; onRemind: () => void; onNews: () => void }

export function MonitorCompanyContext({ position, quote, controller, events, onClose, onWatch, onRemind, onNews }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState('')
  useEffect(() => { dialog.current?.showModal() }, [])
  const region = position.exchange === 'NASDAQ' || position.exchange === 'NYSE' ? 'US' : position.exchange === 'LSE' ? 'GB' : 'IN'
  const query = position.name || position.ticker
  const followed = controller.reading.follows.find((follow) => follow.query.toLowerCase() === query.toLowerCase() && follow.region === region)
  const supportsNews = eligibleHoldings([position]).length > 0
  const recent = controller.allowExternalData && hasSupportedValuationCurrency(position) && usableQuote(quote, controller.now) && freshQuote(quote, controller.now) && (position.type === 'mutual-fund') === (quote.source === 'nav')
  const related = events.filter((event) => event.holdingId === position.id).slice(0, 5)
  const toggleFollow = () => {
    const follows = followed ? controller.reading.follows.filter((item) => item.id !== followed.id) : [...controller.reading.follows, { id: crypto.randomUUID(), query, region: region as 'IN' | 'US' | 'GB' }]
    if (!controller.updateReading({ ...controller.reading, follows })) setError('Could not save this follow. Try again.')
    else setError('')
  }

  return <dialog ref={dialog} className="mp-dialog mp-company-dialog" aria-labelledby="monitor-company-title" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close() }}>
    <div className="mp-section-head"><div><span className="mp-kicker">{position.exchange || 'Holding'}</span><h2 id="monitor-company-title">{query}</h2></div><button type="button" className="mp-icon-button" aria-label="Close company details" onClick={() => dialog.current?.close()}>×</button></div>
    <p className="mp-context-observation">{recent ? <><strong>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: position.currency || 'INR', maximumFractionDigits: 2 }).format(quote.price)}</strong><span>Observed {new Date(quote.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} IST</span></> : 'Waiting for a recent provider observation.'}</p>
    <div className="mp-context-actions"><button type="button" className="mp-button" onClick={onWatch}>Create watch</button><button type="button" className="mp-button" onClick={onRemind}>Remind me</button>{supportsNews && <><button type="button" className="mp-button" onClick={onNews}>Related news</button><button type="button" className="mp-button" aria-pressed={Boolean(followed)} disabled={!followed && controller.reading.follows.length >= MAX_NEWS_FOLLOWS} onClick={toggleFollow}>{followed ? 'Following news' : 'Follow news'}</button></>}</div>
    {error && <p role="alert">{error}</p>}
    {related.length > 0 && <div className="mp-context-events"><h3>Announced updates</h3>{related.map((event) => <a key={event.id} href={event.sourceUrl} target="_blank" rel="noreferrer"><span>{event.title}</span><small>{event.dateLabel} · {event.date} · {event.source}</small></a>)}</div>}
    <a className="workspace-action mp-context-research" href={`/app/research?holding=${encodeURIComponent(position.id)}`}>Open in Research ↗</a>
  </dialog>
}
