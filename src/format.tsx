import type { ReactNode } from 'react'
import type { ChartSpec } from './types'

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\[[^\]\n]+\])|(\*[^*\n]+\*)|(_[^_\n]+_)/g

const CHART_BLOCK_RE = /\[chart\]([\s\S]*?)\[\/chart\]/g

const CHART_VALUE_KEYS = ['value', 'volume', 'pct', 'amount', 'val'] as const
const MAX_CHARTS = 8
const MAX_CHART_ROWS = 20
const MAX_CHART_LABEL_CHARS = 120
const MAX_CHART_TITLE_CHARS = 160

/** Pull chart blocks out of a reply so the surrounding text stays clean. */
export function extractCharts(content: string): { text: string; charts: ChartSpec[] } {
  const charts: ChartSpec[] = []
  const text = content.replace(CHART_BLOCK_RE, (_m, body: string) => {
    const spec = parseChartBlock(body)
    if (spec && charts.length < MAX_CHARTS) {
      charts.push(spec)
      return ''
    }
    return _m
  })
  return { text, charts }
}

/** Models don't always emit strict JSON — tolerate common mistakes (bad commas, wrong key names). */
function parseChartBlock(body: string): ChartSpec | null {
  const cleaned = body.trim()

  const normalize = (obj: unknown): ChartSpec['data'] => {
    if (!obj || !Array.isArray((obj as { data?: unknown }).data)) return []
    const out: ChartSpec['data'] = []
    for (const row of (obj as { data: unknown[] }).data.slice(0, MAX_CHART_ROWS)) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const label = String(r.label ?? '').trim().slice(0, MAX_CHART_LABEL_CHARS)
      let num: number | undefined
      for (const key of CHART_VALUE_KEYS) {
        const v = r[key]
        if (v === undefined) continue
        const n = Number(v)
        if (Number.isFinite(n)) {
          num = n
          break
        }
      }
      if (label && num !== undefined) out.push({ label, value: num })
    }
    return out
  }

  const make = (obj: unknown, data: ChartSpec['data']): ChartSpec | null => {
    if (data.length === 0) return null
    const o = obj as { kind?: unknown; title?: unknown }
    const kind = o.kind === 'pie' || o.kind === 'line' ? o.kind : 'bar'
    return { kind, title: o.title != null ? String(o.title).slice(0, MAX_CHART_TITLE_CHARS) : undefined, data }
  }

  let parsed: unknown = null
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    /* strict parse failed — try tolerant paths below */
  }
  let spec = make(parsed, normalize(parsed))
  if (spec) return spec

  // Repair #1: trailing commas.
  try {
    parsed = JSON.parse(cleaned.replace(/,\s*([}\]])/g, '$1'))
    spec = make(parsed, normalize(parsed))
    if (spec) return spec
  } catch {
    /* continue */
  }

  // Repair #2: row-by-row scan when the body is structurally broken (e.g. "value":1,2).
  const kind = /"kind"\s*:\s*"(\w+)"/.exec(cleaned)?.[1]
  const title = /"title"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(cleaned)?.[1]
  const data: ChartSpec['data'] = []
  const rowRe = /\{\s*"label"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"(?:value|volume|pct|amount|val)"\s*:\s*(-?[\d.eE+]+)/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(cleaned))) {
    const label = m[1].replace(/\\"/g, '"').trim()
    const num = Number(m[2])
    if (label && Number.isFinite(num) && data.length < MAX_CHART_ROWS) data.push({ label: label.slice(0, MAX_CHART_LABEL_CHARS), value: num })
  }
  if (data.length) {
    const k = kind === 'pie' || kind === 'line' ? kind : 'bar'
    return { kind: k, title: title ? title.trim() : undefined, data }
  }

  return null
}

/** Strip leftover markdown markers (#, **) that didn't match a token. */
function cleanLiteral(s: string): string {
  return s.replace(/\*\*/g, '').replace(/##+/g, '').replace(/#/g, '')
}

/** Render the model's reply as styled text — no raw `#` / `**` markdown leaks through. */
export function renderMessage(text: string): ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (/^\s*$/.test(line)) return <div key={i} className="msg-blank" />
    const head = /^(#{1,4})\s+(.+)$/.exec(line)
    if (head) return <div key={i} className="msg-head">{renderInline(head[2])}</div>
    const bullet = /^\s*([-*])\s+(.+)$/.exec(line)
    if (bullet)
      return (
        <div key={i} className="msg-bullet">
          <span className="msg-bullet-dot">•</span>
          {renderInline(bullet[2])}
        </div>
      )
    return <div key={i} className="msg-line">{renderInline(line)}</div>
  })
}

function renderInline(line: string): ReactNode {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RE.exec(line))) {
    if (m.index > last) nodes.push(cleanLiteral(line.slice(last, m.index)))
    const tok = m[0]
    if (tok.startsWith('`')) {
      const inner = tok.slice(1, -1)
      const cls = /^[+]/.test(inner)
        ? 'msg-em msg-em--up'
        : /^[-\u2212]/.test(inner)
          ? 'msg-em msg-em--down'
          : 'msg-em'
      nodes.push(<span key={key++} className={cls}>{inner}</span>)
    } else if (tok.startsWith('**') || tok.startsWith('__'))
      nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('['))
      nodes.push(<span key={key++} className="msg-bracket">{tok}</span>)
    else
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < line.length) nodes.push(cleanLiteral(line.slice(last)))
  return nodes
}
