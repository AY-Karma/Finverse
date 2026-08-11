# Finverse — Portfolio Terminal

A client-side investment portfolio dashboard with a live market-scoreboard feel. Import holdings, review your ledger and allocation, and ask an AI coach about your portfolio.

## Features

- **Portfolio import** — drag in `.xlsx`, `.xls`, or `.csv` files. Each file becomes its own folio.
- **Live scoreboard** — invested, current value, P&L, and XIRR at a glance, across All / Equity / Mutual Fund scopes.
- **Holdings ledger** — per-position and per-MF-scheme tables with symbol/scheme, quantity, buy price, current price, value, and XIRR.
- **Allocation mix** — asset-allocation breakdown with a top-exposure list.
- **AI assistant** — chat with the portfolio context using a configured provider.
- **Terminal look & UX** — dark market theme, compact/comfortable density, and an accent-color picker.

## Tech

- [React 18](https://react.dev) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev)
- [Recharts](https://recharts.org) for charts
- [@e965/xlsx](https://github.com/e965/sheetjs-npm-publisher) 0.20.3 for spreadsheet parsing

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

Portfolio data and chat history stay in this browser's local storage. API keys are kept in session storage only and are cleared when the tab session ends.

External requests are opt-in. Enabling **External market data** sends holding tickers or mutual-fund scheme names to Yahoo Finance (through corsproxy.io), mfapi.in, and Frankfurter for quotes, NAVs, and USD/INR conversion. Using the AI Assistant sends the portfolio digest and conversation to the provider you configure (OpenAI, Anthropic, OpenRouter, or the Ollama endpoint you enter). Finverse has no backend or telemetry service of its own.

## Project layout

```
src/
  App.tsx            App shell, view routing, nav
  store.ts           Persistence helpers
  valuation.ts       Shared price, value, P&L, allocation, and currency logic
  useStore.tsx       React hook over the store
  spreadsheet.ts     Spreadsheet parsing into folios/holdings
  providers.ts       AI provider + chat helpers
  views/             Screen components
```
