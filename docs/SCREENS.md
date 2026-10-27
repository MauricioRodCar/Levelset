# Levelset — Screen Plan (v1.1)

Global frame on every screen:
- **Sidebar** (collapsible): Dashboard · Pipeline · Alerts · Paper account · Analyst · Pelosi · Connections · Settings. Footer: Paper/Live label, tier.
- **Status bar** (top): market open/closed · New York time (ET) · data delay · engine status · AI chat toggle (when AI is on) · language switch.
- **Disclaimer** link always reachable; first-run acceptance required.

Default window 1440×900, minimum 1180×720. Base font 14 px; numbers use tabular figures.

---

## S1. Dashboard (home)

```
┌ Status bar ─────────────────────────────────────────────────────────────┐
├ KPI: Day P/L │ Risk used / limit │ Trades today / max │ Setups found ───┤
├ Ready tickets (≈60 % width) ─────────────┬ Watchlist ───────────────────┤
│  [Ticket card]                            │  ticker · state · % change   │
│  [Ticket card]                            ├ Open trades ─────────────────┤
│  [Blocked ticket, collapsed, with reason] │  qty @ price · P/L · stop→tgt│
│                                           ├ News ────────────────────────┤
└───────────────────────────────────────────┴──────────────────────────────┘
```

### Ticket card spec (most important component)

```
┌─────────────────────────────────────────────────────────┐
│ BUY 8 TSLA   market · day                   ● Risk PASS │
│ ┌ Entry ──────┐ ┌▔▔ Stop loss ▔▔┐ ┌▔▔ Take profit ▔▔┐    │
│ │ 364.18      │ │ 358.32        │ │ 370.04          │    │  ← 24–28 px, weight 500, neutral text colour
│ │ ⧉ copy      │ │ −5.86 ⧉ copy  │ │ +5.86 ⧉ copy    │    │
│ └─────────────┘ └───────────────┘ └─────────────────┘    │
│ Max loss $46.88 · 1R · odds: coin flip     flat by 15:55 │  ← 12 px, muted
│ [ Copy full ticket ]  [ View flow ]  [ ⋯ export / how-to ]│
└─────────────────────────────────────────────────────────┘
```

Rules:
- Levels are the largest text on the screen besides KPI values. Neutral `text` colour, never red/green.
- Stop/target identity = 3 px top bar + small dot in `loss`/`profit`. Entry uses a neutral marker.
- Order is always Entry → Stop loss → Take profit, left to right.
- Click a value = copy that number (toast "Copied 358.32"). Keyboard: `1` `2` `3` copy entry/SL/TP of the focused ticket, `C` copy all, `F` view flow.
- Blocked ticket: collapsed row with red-marked BLOCK badge and the reason in plain words; expandable.
- Stale ticket (entry window passed / price moved > X %): greyed with "Stale — re-run" action.

States: empty ("Run the scanner to find today's setups" + Run button), loading (skeleton), market closed (shows last session + next open time), engine error (retry).

## S2. Pipeline

```
┌ Header: TSLA · opening-range breakout   [Step by step] [Run all] [History ▾] ┐
│ ┌1 Scanner┐→┌2 News┐→┌3 Entry┐→┌4 Exit┐                                      │
│ ┌5 Time machine┐→┌6 Budget┐→┌7 Risk┐→┌8 Ticket┐                             │
├ Detail panel for selected step ──────────────────────────────────────────────┤
│  Inputs (table)  │  Outputs (table / chart)  │  Parameters (editable in wizard)│
└──────────────────────────────────────────────────────────────────────────────┘
```

- Step card: number, name, icon, status badge (Done / Check / Ready / Blocked / Error / Running), one-line "in" and "out".
- Detail panels: Scanner (results table, filters) · News (headlines with tags, 8-Ks) · Entry (5-min chart with opening range + trigger bar) · Exit (chart with stop/target lines) · Time Machine (outcome bar, close-price distribution, history table) · Budget (which limit decided the size) · Risk (checklist of every rule, pass/fail) · Ticket (the ticket card).
- Wizard: one step at a time with Back / Next; parameters editable; "Explain this step" text from the skill's docs (translated).
- History: list of past runs (date, ticker, outcome); opening one is read-only.

## S3. Alerts
- Table: type, ticker, level/time, status (armed / rung), created.
- "Add from plan" (stop, target, flat-by in one click); custom alert form.
- Toggle: Windows notifications, sound.

## S4. Settings
Tabs: **Account & limits** · **Paper account** (auto-follow, slippage) · **Appearance** · **Language** · **Data & SEC** · **AI (optional)** (on/off, model, monthly cap, spend, key) · **System** (start with Windows, keep awake in market hours, demo mode) · **About** (versions, MIT notice for day-trader-skill, licence tier).

Appearance:
```
┌ Presets: [Navy+Teal] [Daylight] [Graphite] [Midnight+Gold] [Mono] [CB-safe] [Hi-contrast] ┐
├ Colour roles (picker each) ──────────┬ Live preview: ticket card + KPI tile ─────────┤
│ background · surface · border · text │                                                │
│ primary · accent · profit · loss ... │  ⚠ "Loss on surface: contrast 3.1:1 (needs 4.5)"│
└ [Save as…] [Import] [Export] [Reset] ┴────────────────────────────────────────────────┘
```

## S5. Connections
- Cards per platform: cTrader, MetaTrader 4, MetaTrader 5, Alpaca, Interactive Brokers.
- Each shows "Tickets: copy / export" + step-by-step how-to (EN/ES).
- v1.1 bridges (cTrader, MT4, MT5): install guide (EN/ES), signals folder, heartbeat status per platform, symbol-mapping editor (US symbol → broker symbol, volume conversion). PASS tickets get "Send to platform"; the card shows sent / placed / dismissed, and the user confirms with Place inside the platform.

## S6. Onboarding (first run)
1. Language → 2. Theme (preset previews) → 3. Account & limits (with sensible defaults, $ max loss explained) → 4. Disclaimer acceptance → 5. "Try the demo trade" or "Scan the market".

## S7. Analyst
- Ticker search → quarters table (revenue, gross / operating / net margin, net income, diluted EPS, each with YoY), TTM, translated "what changed" lines, latest 8-K / press release link.
- Revenue and EPS by quarter chart. "Reports this week" badge also on tickets and the watchlist.
- Prompts for the SEC identity (Settings › Data & SEC) when it is missing. AI "What changed this quarter?" when AI is on.

## S8. Pelosi (Congress trades)
- Feed of House PTR filings: member, owner, ticker, buy/sell, amount range, trade date, days to disclose; "in your watchlist / positions" flag.
- Filters: member, ticker, type, date. Refresh. Toggle "notify me when a new filing mentions my watchlist".
- Note: public disclosures, delayed up to 45 days; not inside information.

## S9. Paper account
- Account switcher (create, reset with confirmation, period selector).
- KPIs: P/L, win rate, expectancy (R), profit factor, max drawdown, longest losing streak. Equity curve.
- Breakdowns by ticker / setup / hour / weekday. Trade log (entry/exit, reason, R, P/L, backfilled, skipped, "View flow"). "Signals vs. you". CSV export.
- Notes: fills are approximate (delayed, bar-based data); the PC must be on, awake and online in market hours.
- Elsewhere: Dashboard tile "Paper P/L today", PAPER badge in Open trades, "Paper: opened 364.29" on the ticket card. AI coach review card when AI is on.

## S10. AI assistant (optional)
- Side chat panel scoped to Levelset data; Explain buttons on pipeline steps, blocked tickets, news and the Analyst page.
- Every answer shows the data it used, its cost and a "not financial advice" footer. Never buy/sell calls or price predictions.

---

## Design tokens — Navy + Teal (default)

| Token | Hex | Use |
|---|---|---|
| bg | #0B1220 | app background (~60 %) |
| surface | #121B2E | cards, panels (~22 %) |
| border | #1E2A44 | hairlines (~4 %) |
| text | #E6EDF7 | primary text **and ticket levels** |
| text-muted | #8A9BB8 | labels, secondary |
| primary | #14B8A6 | main action (one per view) |
| on-primary | #04201D | text on primary |
| accent | #60A5FA | links, info, secondary actions |
| profit | #22C55E | markers, P/L numbers |
| loss | #EF4444 | markers, P/L numbers |
| warning | #F59E0B | "check" states |

Daylight (light) preset starts from: bg #F7F9FC, surface #FFFFFF, border #DCE3EE, text #0F172A, muted #5B6B84, primary #0F766E, profit #15803D, loss #B91C1C.

Typography: Inter (UI) + tabular numerals; JetBrains Mono for JSON/export previews.
