# Changelog

## v1.1.0

Levelset still never sends an order. Bridges only show a ticket inside your platform, and the
order is placed when you click **Place** there.

### Paper account
- Follows every ticket that passes the risk check (auto-follow, on by default; can be switched off).
- Fills at the next bar's open plus slippage (0.02 % + $0.01/share by default, configurable).
  When a bar touches both the stop and the target, the stop counts first. Gaps fill at the bar's
  open. Positions close at the flat-by time.
- Unlimited accounts and periods, with full history. Paper trades never count toward the real
  daily loss or trades-per-day limits.
- Reports: equity curve, P/L, win rate, expectancy (R), profit factor, max drawdown, longest
  losing streak, breakdowns by ticker / setup / hour / weekday, trade log with "View flow",
  "signals vs. you" and CSV export.
- Catch-up: after a restart the engine replays the missed part of the day "as of" those times
  and marks those trades as backfilled. It waits until onboarding is finished, and your own runs
  always go first.
- Dashboard tile "Paper P/L today", PAPER badge in Open trades, paper line on the ticket card.

### AI assistant (optional, off by default)
- Bring your own Claude API key. It is stored in Windows Credential Manager, passed to the engine
  in memory only, and never readable by the UI.
- Choose Haiku, Sonnet (default) or Opus, and set a monthly soft cap (US$5 by default). Each
  answer shows its cost.
- Explain buttons on pipeline steps, blocked tickets, news and the Analyst page. Coach review of
  paper and manual results. Chat panel about your own Levelset data.
- Read-only tools. Answers cite the data they used and carry a "not financial advice" footer.
  An output guard blocks buy/sell calls and price predictions, tested on a red-team set in
  English and Spanish.

### Analyst and Congress trades
- Analyst (trader-analyst): quarters from SEC EDGAR with margins, EPS, YoY, TTM, what changed,
  the latest 8-K, a revenue / EPS chart, and a "reports this week" badge on tickets and the
  watchlist.
- Congress trades (trader-pelosi): House PTR filings with filters, watchlist / position flags,
  and an optional notification when a new filing mentions your watchlist.
- Both pages work offline in demo mode.

### Platform bridges (source in `bridges/`)
- cTrader cBot (C#), MT4 and MT5 EAs read a signals folder and show the ticket with Entry /
  Stop loss / Take profit, volume and max loss, plus **Place** and **Dismiss** buttons.
- Connections page: install guide (EN/ES), signals folder, heartbeat status, and a symbol-mapping
  editor with share-to-lot conversion (rounded down, so the risk never grows).
- Tested against stand-ins only so far. A live check on a Pepperstone demo account is pending, so
  a bridge may get fixes in v1.1.x.

### Desktop
- Closing the window keeps Levelset in the tray. Optional start with Windows and keep-awake
  during market hours. Only one copy of the app can run at a time.
- Demo mode toggle in Settings › System (restarts Levelset).
- Native Save dialog for exports.

### Fixes
- Saving settings no longer waits behind a running pipeline step. Onboarding could look stuck
  before this fix.

## v0.1.0

First release: dashboard tickets, the eight-step pipeline, alerts, settings with seven themes,
English and Spanish, demo mode and the web demo.
