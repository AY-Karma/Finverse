/** Named categorical chart colors, resolved per theme from design tokens. */
export const CHART_COLORS = {
  green: 'var(--chart-green)',
  blue: 'var(--chart-blue)',
  purple: 'var(--chart-purple)',
  pink: 'var(--chart-pink)',
  orange: 'var(--chart-orange)',
  yellow: 'var(--chart-yellow)',
  red: 'var(--chart-red)',
  grey: 'var(--chart-grey)',
} as const

export type ChartColor = keyof typeof CHART_COLORS
