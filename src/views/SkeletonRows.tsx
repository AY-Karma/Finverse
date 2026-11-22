/** Placeholder rows shown where a section's data will appear, so it never pops in or shifts the layout. */
export function SkeletonRows({ rows = 3, label, className = '' }: { rows?: number; label: string; className?: string }) {
  return <div className={`skeleton-rows ${className}`.trim()} role="status" aria-label={label}>
    {Array.from({ length: rows }, (_, row) => <div key={row} aria-hidden="true"><i /><i /></div>)}
  </div>
}
