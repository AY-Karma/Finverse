# Dither Kit sources

Source: https://github.com/Boring-Software-Inc/dither-kit

Imported on 2026-10-17 from the official `core` and `pie-chart`
registries at https://www.tripwire.sh/r/. Only the shared painter and donut sources are included.

Local changes replace Tailwind class names with `dk-*` classes. The roots join
their two class names directly, so `clsx`, `tailwind-merge`, Tailwind, and Motion
are not required. Unused Cartesian chart files are omitted. Shared types live
in `chart-types.ts`, and the revision hook lives with its only caller in
`polar-context.tsx`. The polar root exposes `onHoverChange` so chart and legend
details update in the same pointer event. No additional runtime dependencies are required.

Overview's donut adapter and styles live in `src/views/overview/`. The shared
`src/views/DitherBar.tsx` uses the kit's `paintColumn` renderer for Overview's
composition bars, Insights' treemap, exposure mix, price movers and risk gauges,
and Monitor's activity summary bars. Hover highlights keep values readable
without bloom. Holding price history uses a subdued blue `DitherAreaFill` inside
`InteractiveTrendChart`, with a horizontal average-cost reference and opaque
price readouts. Its fill stays unchanged on hover.
Performance story uses `DitherAreaFill.tsx` with the same painter inside the
existing chart, retaining its axes, hover readouts, history navigation, and
invested-capital reference line. Benchmark race fills the gap between the portfolio
and benchmark with blue dither, including crossings and returns below zero. Missing
benchmark observations leave gaps. Both Insights charts retain their
full daily history for the shared 180-point viewport. Drag, horizontal wheel,
Shift+wheel, and keyboard navigation move that viewport; loading older history
preserves the visible dates. Other trend charts keep their original fills.

Insights' four summary cards use decorative dither accents. Their expanded
panels reuse `DitherBar` for session impacts, top-five weights, and data-health
status accents, and `DitherAreaFill` for the red peak-to-trough drawdown band.
Values remain masked when privacy is enabled.

The shared painter writes into a reusable `ImageData` buffer and uploads once per
draw. Area and bar components compare their numeric inputs to skip unchanged
paints. The donut paints only when its slice appearance changes; its entrance
sweep composites a cached texture and stops scheduling frames when complete.
Trend paths draw the visible date window plus one observation at either edge;
the complete daily history remains available for navigation and calculations.

To refresh these sources, compare the same registry files, retain the local
class-name adaptations and the smaller shared core, and verify the affected previews.
