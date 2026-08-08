# Finverse — Portfolio Terminal

A client-side investment portfolio dashboard with a live market-scoreboard feel. Import holdings, watch your ledger and allocation live, and ask an AI coach about your board — all without a backend, all stored locally in your browser.

## Features

- **Portfolio import** — drag in `.xlsx`, `.xls`, or `.csv` files. Each file becomes its own folio.
- **Live scoreboard** — invested, current value, P&L, and XIRR at a glance, across All / Equity / Mutual Fund scopes.
- **Holdings ledger** — per-position and per-MF-scheme tables with symbol/scheme, quantity, buy price, current price, value, and XIRR.
- **Allocation mix** — asset-allocation breakdown with a top-exposure list.
- **AI assistant ("the coach")** — chat with the portfolio loaded in your browser. Works with local providers (no key) or OpenAI-compatible endpoints configured in Settings.
- **Terminal look & UX** — dark market-theme, compact/comfortable density, and an accent-color picker.

## Tech

- [React 18](https://react.dev) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev)
- [Recharts](https://recharts.org) for charts
- [SheetJS (xlsx)](https://sheetjs.com) for spreadsheet parsing
- [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) / [JetBrains Mono](https://www.jetbrains.com/lp/mono/) for the terminal type

## Getting started

```bash
npm install
npm run dev
```

Open the local URL Vite prints (default `http://localhost:5173`).

Other scripts:

```bash
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build locally
```

## Data & privacy

Everything lives in your browser's `localStorage` — nothing is sent to a server. The AI Assistant only makes requests when you enable a provider in Settings with an API key; otherwise it uses a local provider.

## Project layout

```
src/
  App.tsx            App shell, view routing, nav
  store.ts           Data model + persistence + formatting
  useStore.tsx       React hook over the store
  spreadsheet.ts     SheetJS parsing into folios/holdings
  providers.ts       AI provider + chat helpers
  theme.ts           Accent palettes + theme/apply()
  types.ts           Shared types
  views/             Overview · ImportView · AssistantView · SettingsView
```