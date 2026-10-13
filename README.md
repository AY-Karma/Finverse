<div align="center">
  <img src="public/favicon.svg" alt="Finverse logo" width="56" height="56" />

  <h1>Finverse</h1>

  <p><strong>Know what you own. See what moves.</strong></p>
  <p>A private workspace for equities, ETFs, and mutual funds. Import holdings, inspect allocation and P&L, and trace daily moves to the positions behind them.</p>

  <p>
    <a href="#what-you-can-do">Explore features</a> ·
    <a href="#get-started">Get started</a> ·
    <a href="#your-data">Your data</a>
  </p>
</div>

## What you can do

- **See the whole portfolio.** View current value, invested capital, P&L, holdings, and allocation across separate folios.
- **Find what changed.** Trace daily movers to individual holdings and inspect price or NAV history.
- **Put performance in context.** Explore concentration and risk, then compare your portfolio with a market benchmark.
- **Follow your holdings.** Filter portfolio news and open research links for the instruments you own.
- **Download your data.** Import `.xlsx`, `.xls`, or `.csv` holdings files, then export a CSV copy or a JSON archive.

## Get started

You need Node.js and npm. From the repository root:

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite to enter the portfolio workspace. In Settings, import a holdings export and choose Add another account or Update existing account. Updates require selecting the account and confirming a complete statement with no rejected rows. Review the position changes and resulting totals before saving. The previous statement is retained for undo, including after a reload.

Statements have a date separate from their upload time. Provider quotes take precedence when enabled. Across accounts, imported prices use the latest dated statement with a usable price. Equal dates or wholly undated statements use import order. Conflicting prices and missing dates appear in a review notice. Account changes record tracked balances, not investment returns.

Run `npm run build` to check the TypeScript code and create a production build.

## Your data

Finverse stores holdings and preferences in your browser. External market data is off by default; turning it on sends instrument identifiers to market data providers for quotes, history, and news.

Portfolio totals use INR holdings. USD holdings retain their native amounts in storage and exports, but are excluded from aggregate INR cost and valuation with a partial-total notice. Choosing USD as the display currency converts the INR subtotal; it does not combine native USD holdings into it.

Historical backcasts apply **today's holdings** to past prices, so they do not represent past trades. Tracked history starts when daily portfolio snapshots begin accumulating on this device.

Clearing browser data removes your local workspace. In Settings, use Backup JSON to save accounts, preferences, tracked balances and Monitor data, then Restore backup to review and recover them in another browser. Backups are unencrypted financial records; keep them private. Restoring replaces the current workspace, keeps a recovery copy for undo, and leaves external market data off until you enable it again. Older holdings-only JSON exports can also be restored, but cannot recover omitted history or Monitor data.
