export type HeadlineTone = 'positive' | 'negative' | 'mixed' | 'unknown'

export interface HeadlineAssessment {
  status: HeadlineTone
  reason: string
}

interface Signal {
  positive: boolean
  /** Price movement > earnings surprise > financial trend > supporting event. */
  priority: number
  evidence: string
}

const PRICE_SUBJECT = /shares?|stocks?|markets?|indices|index|sensex|nifty|nasdaq|dow|s&p(?: 500)?|adrs?|gold(?: prices)?|silver(?: prices)?|bitcoin|rupee/
const ADVERSE_SUBJECT = /loss(?:es)?|costs?|expenses?|debt|inflation|jobless claims|unemployment|layoffs|defaults?|bad loans|npas?|oil prices|crude prices|yields?|(?:interest |mortgage )?rates?|taxes|outflows?/
const BENEFICIAL_SUBJECT = /profits?|earnings|revenues?|sales|demand|exports?|gdp|output|margins?|eps|pat|dividends?|employment|jobs|volumes?|inflows?/
const SUBJECTS = new RegExp(`\\b(?:${PRICE_SUBJECT.source}|${ADVERSE_SUBJECT.source}|${BENEFICIAL_SUBJECT.source})\\b`, 'g')
const IS_PRICE = new RegExp(`^(?:${PRICE_SUBJECT.source})$`)
const IS_ADVERSE = new RegExp(`^(?:${ADVERSE_SUBJECT.source})$`)
const RISING = /up|ris(?:e|es|en|ing)|rose|gain(?:s|ed|ing)?|jump(?:s|ed|ing)?|surg(?:e|es|ed|ing)|rall(?:y|ies|ied|ying)|soar(?:s|ed|ing)?|grow(?:s|ing)?|grew|grown|increas(?:e|es|ed|ing)|improv(?:e|es|ed|ing)|recover(?:s|ed|ing|y)?|rebound(?:s|ed|ing)?|widen(?:s|ed|ing)?|advanc(?:e|es|ed|ing)|strengthen(?:s|ed|ing)?|doubl(?:e|es|ed|ing)|peak(?:s|ed)?|spik(?:e|es|ed|ing)|hik(?:e|es|ed|ing)|high(?:s|er|est)?|in (?:the )?green/
const FALLING = /down|fall(?:s|en|ing)?|fell|drop(?:s|ped|ping)?|plung(?:e|es|ed|ing)|declin(?:e|es|ed|ing)|slump(?:s|ed|ing)?|tumbl(?:e|es|ed|ing)|crash(?:es|ed|ing)?|slid(?:e|es|ing)|slid|slip(?:s|ped|ping)?|sink(?:s|ing)?|sank|shr(?:ink|inks|inking|ank|unk)|narrow(?:s|ed|ing)?|reduc(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|cut(?:s|ting)?|slash(?:es|ed|ing)?|slow(?:s|ed|ing)?|shed(?:s)?|los(?:e|es|ing)|lost|retreat(?:s|ed|ing)?|weaken(?:s|ed|ing)?|low(?:s|er|est)?|in (?:the )?red/
const DIRECTIONS = new RegExp(`\\b(?:${RISING.source}|${FALLING.source})\\b`, 'g')
const UPWARD = new RegExp(`^(?:${RISING.source})$`)
const PRICE_MOVEMENT = /^(?:up|down|ris|rose|gain|jump|surg|rall|soar|fall|fell|drop|plung|slump|tumbl|crash|slid|slip|sink|sank|advanc|shed|lost|recover|rebound)/
const UNCERTAIN = /\b(?:not|no|never|without|den(?:y|ies|ied)|avoid(?:s|ed)?|halt(?:s|ed)?|prevent(?:s|ed)?|could|might|may|would|should|can|if|whether|expected to|set to|likely to)\b/

const EVENT_RULES: { pattern: RegExp; positive: boolean; priority: number }[] = [
  { pattern: /\b(?:beat(?:s)?|exceed(?:s|ed)?)\s+(?:(?:analyst|market|street|earnings|profit|revenue)\s+)*(?:estimates?|expectations?|forecasts?)\b|\bearnings beat\b/g, positive: true, priority: 3 },
  { pattern: /\b(?:miss(?:es|ed)?|below)\s+(?:(?:analyst|market|street|earnings|profit|revenue)\s+)*(?:estimates?|expectations?|forecasts?)\b|\bearnings miss\b/g, positive: false, priority: 3 },
  { pattern: /\b(?:record|strong|robust)\s+(?:profits?|earnings|sales|revenues?)\b|\breturns? to profit\b|\bturns? profitable\b/g, positive: true, priority: 2 },
  { pattern: /\b(?:weak|poor|disappointing)\s+(?:profits?|earnings|sales|revenues?|demand)\b|\b(?:posts?|reports?|swings? to)\s+(?:a\s+)?loss\b/g, positive: false, priority: 2 },
  { pattern: /\b(?:rais(?:e|es|ed)|lift(?:s|ed)?|upgrad(?:e|es|ed))\s+(?:[\w-]+\s+){0,2}(?:guidance|outlook|rating|price targets?|target prices?)\b|\b(?:upgrad(?:e|es|ed)|buy rating)\b/g, positive: true, priority: 2 },
  { pattern: /\b(?:cut(?:s)?|lower(?:s|ed)?|slash(?:es|ed)?|downgrad(?:e|es|ed))\s+(?:[\w-]+\s+){0,2}(?:guidance|outlook|rating|price targets?|target prices?)\b|\bdowngrad(?:e|es|ed)\b/g, positive: false, priority: 2 },
  { pattern: /\b(?:win(?:s)?|won|secur(?:e|es|ed)|bag(?:s|ged)?)\s+(?:\S+\s+){0,4}(?:orders?|contracts?|deals?)\b|\b(?:gets?|receiv(?:e|es|ed)|wins?)\s+(?:\w+\s+){0,3}approval\b/g, positive: true, priority: 2 },
  { pattern: /\b(?:bankruptcy|insolvency|fraud|scam|defaults?|layoffs|recall(?:s|ed)?)\b|\b(?:faces?|facing)\s+(?:\w+\s+){0,2}(?:probe|lawsuit|penalty|ban)\b/g, positive: false, priority: 1 },
  { pattern: /\b(?:dismiss(?:es|ed)?|drops?|dropped)\s+(?:\w+\s+){0,2}(?:charges?|lawsuits?)\b|\b(?:charges?|lawsuits?|ban)\s+(?:\w+\s+){0,2}(?:dismissed|dropped|lifted)\b|\bcleared of (?:\w+\s+){0,2}fraud\b/g, positive: true, priority: 2 },
  { pattern: /\b(?:declar(?:e|es|ed)|announc(?:e|es|ed)|approv(?:e|es|ed))\s+(?:\S+\s+){0,5}(?:dividends?|buybacks?)\b|\b(?:foreign|fund|capital) inflows?\b/g, positive: true, priority: 1 },
  { pattern: /\b(?:foreign|fund|capital) outflows?\b|\b(?:risks?|headwinds|pressure)\s+(?:for|to|on)\s+(?:\w+\s+){0,2}(?:growth|profits?|earnings|markets?)\b|\b(?:hurts?|weighs on)\s+(?:\w+\s+){0,3}(?:profits?|earnings|demand|growth)\b/g, positive: false, priority: 2 },
  { pattern: /\bgainers\b/g, positive: true, priority: 4 },
  { pattern: /\blosers\b/g, positive: false, priority: 4 },
  { pattern: /\b(?:turned|became|become)\s+(?:\w+\s+){0,2}multibaggers?\b/g, positive: true, priority: 4 },
]

function qualified(clause: string, start: number, end: number): boolean {
  const before = clause.slice(0, start).split(/\s+/).slice(-5).join(' ')
  const after = clause.slice(end).split(/\s+/).slice(0, 4).join(' ')
  return UNCERTAIN.test(before) || /\b(?:denied|dismissed|avoided|ruled out)\b/.test(after)
}

function directionalSignals(clause: string, inheritedPriceContext: boolean): Signal[] {
  const subjects = [...clause.matchAll(SUBJECTS)]
  const signals: Signal[] = []
  for (const movement of clause.matchAll(DIRECTIONS)) {
    const end = movement.index + movement[0].length
    if (qualified(clause, movement.index, end)) continue
    if (movement[0] === 'up' && /^\s+to\b/.test(clause.slice(end))) continue
    if (/^(?:high|low)s?$/.test(movement[0]) && /\b(?:from|off)\b[^,;]{0,24}$/.test(clause.slice(0, movement.index))) continue
    const preceding = subjects.filter((subject) => subject.index < movement.index).at(-1)
    const following = subjects.find((subject) => subject.index >= end)
    const nearBefore = preceding && clause.slice(preceding.index + preceding[0].length, movement.index).trim().split(/\s+/).length <= 7
    const nearAfter = following && clause.slice(end, following.index).trim().split(/\s+/).length <= 3
    const adjective = /ing$|^(?:high|low)(?:s|er|est)?$/.test(movement[0])
    const subject = nearAfter && adjective ? following : nearBefore ? preceding : nearAfter ? following : undefined
    const upward = UPWARD.test(movement[0])
    if (subject) {
      if (qualified(clause, Math.min(subject.index, movement.index), Math.max(subject.index + subject[0].length, end))) continue
      const price = IS_PRICE.test(subject[0])
      const evidence = clause.slice(Math.min(subject.index, movement.index), Math.max(subject.index + subject[0].length, end)).trim()
      signals.push({ positive: IS_ADVERSE.test(subject[0]) ? !upward : upward, priority: price ? 4 : 2, evidence })
    } else if (inheritedPriceContext && !subjects.length && PRICE_MOVEMENT.test(movement[0])) {
      signals.push({ positive: upward, priority: 4, evidence: clause.trim() })
    } else if (/^\s+(?:by\s+)?(?:nearly\s+|about\s+)?\d+(?:\.\d+)?%/.test(clause.slice(end)) && /^\w+(?:\s+is)?\s*$/.test(clause.slice(0, movement.index))) {
      signals.push({ positive: upward, priority: 2, evidence: clause.trim() })
    }
  }
  return signals
}

/** Estimated financial headline tone; price moves take precedence over their background causes. */
export function classifyHeadline(title: string): HeadlineAssessment {
  const text = title.toLowerCase().replace(/[’‘]/g, "'")
  const sentences = text.split(/[;:]|(?<=[!?])\s+|(?<!\brs)\.\s+/).filter((sentence) => !sentence.includes('?'))
  const signals: Signal[] = []
  for (const sentence of sentences) {
    let priceContext = false
    const clauses = sentence.split(/,(?!\d)|\b(?:but|while|whereas|as|after|amid|despite|because|however|although)\b/)
    for (const clause of clauses) {
      signals.push(...directionalSignals(clause, priceContext))
      if ([...clause.matchAll(SUBJECTS)].some((match) => IS_PRICE.test(match[0]))) priceContext = true
      for (const rule of EVENT_RULES) {
        for (const match of clause.matchAll(rule.pattern)) {
          if (qualified(clause, match.index, match.index + match[0].length)) continue
          signals.push({ positive: rule.positive, priority: rule.priority, evidence: match[0] })
        }
      }
    }
  }
  if (!signals.length) return { status: 'unknown', reason: 'This headline does not establish a clear financial direction.' }
  const priority = Math.max(...signals.map((signal) => signal.priority))
  const primary = signals.filter((signal) => signal.priority === priority)
  const positive = primary.find((signal) => signal.positive)
  const negative = primary.find((signal) => !signal.positive)
  if (positive && negative) return { status: 'mixed', reason: `Opposing signals: “${positive.evidence}” and “${negative.evidence}”.` }
  const signal = (positive ?? negative)!
  return { status: signal.positive ? 'positive' : 'negative', reason: `Based on “${signal.evidence}”.` }
}
