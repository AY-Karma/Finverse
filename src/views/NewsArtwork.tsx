import type { MarketBriefingTopic } from '../marketBriefing'

export function NewsArtwork({ topic }: { topic: MarketBriefingTopic }) {
  return <svg className="story-art story-news-art" viewBox="0 0 400 240" fill="none" aria-hidden="true" focusable="false">
    <ellipse cx="200" cy="214" rx="135" ry="10" fill="currentColor" opacity=".05" />
    {topic === 'policy' ? <>
      <path d="m92 85 108-50 108 50H92Z" fill="currentColor" opacity=".15" />
      <path d="m92 85 108-50 108 50H92ZM86 202h228M101 187h198" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      {[120, 165, 210, 255].map((x) => <g key={x}><path d={`M${x} 100h25v73h-25v-73Z`} fill="currentColor" opacity=".12" /><path d={`M${x} 100h25m-25 73h25m-20-66v59m15-59v59`} stroke="currentColor" strokeWidth="1.5" /></g>)}
      <circle cx="200" cy="66" r="8" stroke="currentColor" strokeWidth="1.5" />
    </> : topic === 'commodities' ? <>
      <path d="m132 58 72-17 62 32-72 18-62-33Z" fill="currentColor" opacity=".25" />
      <path d="m132 58 62 33v112l-62-33V58Z" fill="currentColor" opacity=".1" />
      <path d="m194 91 72-18v112l-72 18V91Z" fill="currentColor" opacity=".3" />
      <path d="m132 88 62 33 72-18M132 137l62 33 72-18" stroke="currentColor" opacity=".6" />
      <path d="M194 114c-10 15-19 25-19 35a19 19 0 0 0 38 0c0-10-9-20-19-35Z" stroke="currentColor" strokeWidth="2" />
      <circle cx="292" cy="172" r="25" fill="var(--story-art-back)" stroke="currentColor" strokeWidth="1.5" /><circle cx="292" cy="172" r="16" stroke="currentColor" opacity=".4" />
    </> : topic === 'earnings' ? <>
      <path d="M121 36h116l43 43v127H121V36Z" fill="currentColor" opacity=".1" />
      <path d="M121 36h116l43 43v127H121V36Zm116 0v43h43M145 99h48m-48 18h31" stroke="currentColor" strokeWidth="1.5" />
      {[{ x: 148, y: 153 }, { x: 181, y: 132 }, { x: 214, y: 116 }].map(({ x, y }) => <rect key={x} x={x} y={y} width="19" height={184 - y} rx="2" fill="currentColor" opacity=".4" />)}
    </> : <>
      <circle cx="200" cy="120" r="83" fill="currentColor" opacity=".06" />
      <circle cx="200" cy="120" r="83" stroke="currentColor" strokeWidth="1.5" opacity=".55" />
      <ellipse cx="200" cy="120" rx="42" ry="83" stroke="currentColor" opacity=".35" />
      <ellipse cx="200" cy="120" rx="83" ry="32" stroke="currentColor" opacity=".35" />
      <path d="M117 120h166M200 37v166" stroke="currentColor" opacity=".25" />
      <path d="m146 68 20-8 15 15-5 22-17 7-10 26 9 17-8 22-15-24-6-32 17-16V68Zm66 0 30-6 20 28-10 18-24 7-7 23-15-12 5-18-9-18 10-22Zm26 89 24-4 11 22-19 10-16-28Z" fill="currentColor" opacity=".25" />
      <circle cx={topic === 'china' ? 246 : topic === 'india' ? 225 : 157} cy={topic === 'china' ? 95 : topic === 'india' ? 118 : 83} r="7" fill="currentColor" />
      <ellipse cx="200" cy="120" rx="133" ry="43" transform="rotate(-27 200 120)" stroke="currentColor" opacity=".3" />
    </>}
    <path d="M72 97h14m-7-7v14M307 51h10m-5-5v10" stroke="currentColor" strokeWidth="1.5" opacity=".45" />
  </svg>
}
