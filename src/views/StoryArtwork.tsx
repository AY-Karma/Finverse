/** Data artwork has an equivalent readable summary beside it. */
export function StoryArtwork() {
  return <svg className="story-art story-art--month" viewBox="0 0 400 220" fill="none" aria-hidden="true" focusable="false">
    <ellipse cx="200" cy="196" rx="155" ry="12" fill="currentColor" opacity=".05" />
    <path d="m107 47 156 15 28 131-156-15-28-131Z" fill="currentColor" opacity=".08" />
    <path d="M113 34h165v146H113V34Z" fill="var(--story-art-back)" stroke="currentColor" strokeWidth="1.5" />
    <path d="M113 69h165M145 23v24m100-24v24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    {[0, 1, 2].map((row) => <g key={row}>{[0, 1, 2, 3].map((col) => <rect key={col} x={134 + col * 34} y={87 + row * 29} width="16" height="12" rx="2" fill="currentColor" opacity={row === 1 && col === 2 ? .8 : .12 + row * .05} />)}</g>)}
    <circle cx="292" cy="151" r="29" fill="var(--story-art-back)" stroke="currentColor" strokeWidth="1.5" />
    <path d="M292 134v18l10 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M72 116h18m-9-9v18M314 65h12m-6-6v12" stroke="currentColor" strokeWidth="1.5" opacity=".5" />
  </svg>
}
