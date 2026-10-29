import { useId, type ReactNode } from 'react'
import { IMPORT_SOURCES } from '../importSources'
import { ActionIcon, type ActionIconName } from './ActionIcon'
import './portfolioWelcome.css'

const WELCOME_CONTENT = {
  overview: {
    area: 'Overview', eyebrow: 'A little perspective for your portfolio',
    title: 'Your portfolio.', emphasis: 'In focus.',
    description: "Bring your holdings together. See where you stand, how you're invested, and what deserves a closer look.",
    artTitle: 'The bigger picture', icon: 'overview',
    legend: ['Equities', 'ETFs', 'Mutual funds'], destination: 'A clearer view',
  },
  insights: {
    area: 'Insights', eyebrow: 'Get to know your investments',
    title: 'Your investments.', emphasis: 'A closer look.',
    description: 'See what drives your returns, where your money is concentrated, and how your holdings fit together.',
    artTitle: 'Beneath the total', icon: 'insights',
    legend: ['Performance', 'Allocation', 'Exposure'], destination: 'More perspective',
  },
  research: {
    area: 'Research', eyebrow: 'Follow your curiosity',
    title: 'Your holdings.', emphasis: 'Well researched.',
    description: 'Get to know the companies and funds you own. Keep reports, financials, and research sources within reach.',
    artTitle: 'Follow the sources', icon: 'research',
    legend: ['Reports', 'Financials', 'Sources'], destination: 'Company context',
  },
  monitor: {
    area: 'Monitor', eyebrow: 'The updates around your investments',
    title: 'Your holdings.', emphasis: 'In the loop.',
    description: 'News, company updates and watches, tied to the investments you own.',
    artTitle: 'Your first edition', icon: 'bell',
    legend: ['News', 'Watches', 'Reminders'], destination: 'Stay informed',
  },
} satisfies Record<string, { area: string; eyebrow: string; title: string; emphasis: string; description: string; artTitle: string; icon: ActionIconName; legend: string[]; destination: string }>

type WelcomeVariant = keyof typeof WELCOME_CONTENT

export function PortfolioWelcome({ onRequestImport, variant = 'overview', children }: { onRequestImport: () => void; variant?: WelcomeVariant; children?: ReactNode }) {
  const id = useId()
  const content = WELCOME_CONTENT[variant]

  return (
    <section className={`portfolio-welcome portfolio-welcome--${variant} enter`} aria-labelledby={`${id}-title`}>
      <div className="portfolio-welcome-topline">
        <span>{content.area}</span>
      </div>

      <div className="portfolio-welcome-main">
        <div className="portfolio-welcome-copy">
          <span className="portfolio-welcome-eyebrow">{content.eyebrow}</span>
          <h1 id={`${id}-title`}>{content.title}<br /><span>{content.emphasis}</span></h1>
          <p>{content.description}</p>
          <div className="portfolio-welcome-import">
            <button className="btn btn--import" type="button" aria-haspopup="dialog" onClick={onRequestImport}>
              <ActionIcon name="import" />Import portfolio
            </button>
            <span className="portfolio-welcome-formats">.xlsx / .xls / .csv</span>
          </div>
          <span className="portfolio-welcome-privacy"><ActionIcon name="privacy" />No broker login. Review before you add.</span>
        </div>

        {children ?? <div className="portfolio-welcome-art" aria-hidden="true">
          <div className="portfolio-welcome-art-head"><span>{content.artTitle}</span><ActionIcon name={content.icon} /></div>
          <div className="portfolio-welcome-orbit">
            <svg viewBox="0 0 360 320" fill="none" focusable="false">
              <defs>
                {['primary', 'secondary', 'muted'].map((tone) => (
                  <pattern key={tone} id={`${id}-${tone}`} width="4" height="4" patternUnits="userSpaceOnUse">
                    <circle className={`portfolio-welcome-ring-${tone}`} cx="1" cy="1" r="1" fill="currentColor" />
                  </pattern>
                ))}
              </defs>
              {variant === 'overview' && <>
                <g className="portfolio-welcome-guides">
                  <path d="M180 12v42m0 212v42M32 160h42m212 0h42" />
                  <circle cx="180" cy="160" r="133" strokeDasharray="2 6" />
                  <circle cx="180" cy="160" r="76" />
                </g>
                <g strokeWidth="42" transform="rotate(-90 180 160)">
                  <circle stroke={`url(#${id}-primary)`} cx="180" cy="160" r="103" pathLength="100" strokeDasharray="56 44" />
                  <circle stroke={`url(#${id}-secondary)`} cx="180" cy="160" r="103" pathLength="100" strokeDasharray="26 74" strokeDashoffset="-58" />
                  <circle stroke={`url(#${id}-muted)`} cx="180" cy="160" r="103" pathLength="100" strokeDasharray="12 88" strokeDashoffset="-86" />
                </g>
              </>}
              {variant === 'insights' && <>
                <g className="portfolio-welcome-guides">
                  <path d="M36 64h288M36 128h288M36 192h288M36 256h288M36 40v216" />
                </g>
                {[96, 164, 126, 196, 150].map((height, index) => (
                  <rect key={index} x={58 + index * 52} y={256 - height} width="30" height={height} fill={`url(#${id}-${index === 2 ? 'secondary' : 'primary'})`} />
                ))}
                <path className="portfolio-welcome-guides" d="M68 274h10m42 0h10m42 0h10m42 0h10m42 0h10" />
              </>}
              {variant === 'research' && <>
                <g className="portfolio-welcome-guides">
                  <circle cx="180" cy="160" r="133" strokeDasharray="2 6" />
                  <rect x="64" y="72" width="192" height="220" rx="7" />
                  <rect x="80" y="56" width="192" height="220" rx="7" className="portfolio-welcome-paper" />
                  <rect x="96" y="40" width="192" height="220" rx="7" className="portfolio-welcome-paper" />
                </g>
                <path className="portfolio-welcome-guides" d="M116 66h72m-72 10h42M116 222h148m-148 12h104" />
                <circle cx="184" cy="144" r="54" fill={`url(#${id}-primary)`} />
                <circle cx="184" cy="144" r="34" className="portfolio-welcome-paper" />
                <g className="portfolio-welcome-research-mark" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M173 125h14l9 9v28h-23v-37Zm14 0v9h9m-17 9h11m-11 7h11M223 183l22 22" />
                  <circle cx="184" cy="144" r="57" />
                </g>
              </>}
            </svg>
            {variant === 'overview' && <div className="portfolio-welcome-orbit-center"><ActionIcon name="holdings" /><span>One portfolio.<br />All the pieces.</span></div>}
          </div>
          <div className="portfolio-welcome-art-legend">{content.legend.map((label) => <span key={label}>{label}</span>)}</div>
          <div className="portfolio-welcome-art-foot"><ActionIcon name="sources" /><span>Your holdings</span><span className="portfolio-welcome-art-connector" /><span>{content.destination}</span></div>
        </div>}
      </div>

      <div className="portfolio-welcome-sources">
        <span>Start with a holdings export</span>
        <ul aria-label="Broker statement sources">
          {IMPORT_SOURCES.map((source) => <li key={source.id}><img src={source.icon} alt="" width="18" height="18" /><span>{source.name}</span></li>)}
        </ul>
      </div>
    </section>
  )
}
