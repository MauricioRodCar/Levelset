# Levelset — Product Requirements (v0.1, draft for sign-off)

Status: **Draft — awaiting owner sign-off. No code until approved.**
Owner: Mauricio · Date: 2026-10-25

## 1. Vision

Levelset is a desktop app that puts the 11 day-trader skills
([Jakeschincariol/day-trader-skill](https://github.com/Jakeschincariol/day-trader-skill), MIT)
behind a clear, trustworthy GUI. A trader sees the three numbers that matter
— **entry, stop loss, take profit** — instantly, and can always open the full
pipeline to see *why* a ticket was produced.

Two promises:
1. **Fast** — the Dashboard answers "what can I trade now and at what levels" in one glance.
2. **Transparent** — every ticket links to the Pipeline that produced it, step by step, inputs and outputs visible.

## 2. Users

| Persona | Needs |
|---|---|
| Frequent trader (primary, incl. owner) | Signals and tickets fast; copy levels into cTrader / MT4 / MT5 in seconds |
| New / cautious trader | Understand and trust the process before risking money; guided wizard |
| Portfolio visitor / recruiter | Try a demo in the browser without installing anything |
| Tester (later) | Full features via an expiring Tester key |

v1 is used by the owner only. Testers come later.

## 3. Decisions already made

| Topic | Decision |
|---|---|
| Platform | Windows desktop first (Tauri 2). macOS/Linux possible later |
| Stack | Tauri 2 + React/TypeScript + Tailwind + shadcn/ui; local Python engine (FastAPI) wrapping the skill scripts |
| AI | Tools are mandatory and work without AI. AI (bring-your-own Claude API key) is optional and adds plain-language summaries |
| Broker / platforms | Generic. v1: universal tickets (copy per value, copy all, CSV/JSON export, per-platform how-to). Later: bridges and direct APIs via adapters |
| Order execution | v1 never sends orders. Any later execution always needs an explicit per-order confirmation |
| Layout | Cockpit + Pipeline (Dashboard home + Pipeline view, linked by "View flow") |
| Palette | Navy + Teal default; all colours customizable; 7 presets incl. a light theme |
| Languages | English and Spanish from v1 |
| Monetization | Open core, one app, one installer, key tiers: Free / Pro / Tester (expiring, revocable) |
| Name | Levelset (web search found no trading-software conflict; formal trademark check before selling) |
| Location | `Desktop\Levelset`, git repo, public portfolio repo later |

## 4. Scope

### v1.0 — MVP (Free tier, owner use)

**F1. Dashboard (home)**
- KPI row: day P/L (manual/recorded fills), risk used vs daily limit, trades today vs max, setups found.
- **Ready tickets** list (see F3). Blocked tickets shown with the reason.
- Watchlist with entry state per ticker (waiting / triggered / expired) and % change.
- Open trades: position, unrealized P/L, progress bar between stop and target, flat-by time.
- News strip for watchlist tickers (tags: earnings, analyst, deal…).
- Status bar: market open/closed (NYSE calendar), New York time, **data delay indicator**, paper/live label, tier.

**F2. Pipeline**
- 8 connected step cards: Scanner → News → Entry → Exit → Time Machine → Budget → Risk → Ticket.
- Each card: status (done / check / ready / blocked / error), **inputs**, **outputs**, timestamp.
- Click a card → detail panel (full result, charts where relevant, e.g. Time Machine outcome bar, entry chart with opening range).
- Modes: **Step by step** (wizard with Next, editable parameters per step) and **Run all**.
- Opened from a ticket's "View flow" it shows that trade's stored run (audit trail).
- Run history: every pipeline run saved locally and re-openable.

**F3. Tickets (core UX requirement)**
- Entry, stop loss, take profit are the **largest text on the card** (≥ 24 px, tabular numerals), in **neutral text colour**.
- Colour is limited to small markers (thin top bar + dot) so it never competes with the numbers.
- Per-value copy button; "Copy full ticket"; export CSV/JSON.
- Secondary line (smaller): max loss, R multiple, Time Machine verdict, flat-by time, risk PASS/BLOCK.
- "How to enter this in cTrader / MT4 / MT5" help card per platform.
- Instrument note: warns that CFD symbols/contract sizes may differ from the US stock analysed.

**F4. Alerts**
- Create from plan (stop, target, flat-by), price above/below, % move, time, opening bell.
- Windows desktop notifications + in-app alert log; each alert rings once.

**F5. Settings**
- Account & limits (writes the skills' config): account size, max loss per trade, daily loss limit, trades/day, min reward:risk, entry window, cash buffer, PDT guard.
- SEC identity (`sec_user_agent`).
- Appearance: theme presets, per-role colour pickers with live ticket preview, save/import/export palettes, contrast warning (WCAG AA).
- Language: English / Español. Number/date formatting follows locale; market times always New York (ET).
- Optional AI: Claude API key stored in Windows Credential Manager, never in plain files. Off by default.

**F6. Demo mode**
- Runs entirely on the skills' bundled fixtures (TSLA 2026-10-19 example).
- Same UI built as a static web demo for GitHub Pages (portfolio).

**F7. Onboarding & safety**
- First-run wizard: language, theme, account limits, disclaimer acceptance.
- Persistent "Not financial advice" and data-delay notices.

### v1.1
- Analyst page (earnings, margins, EPS — trader-analyst).
- Pelosi / Congress trades page (trader-pelosi).
- AI summaries (BYO key): news digest, earnings summary, plain-language pipeline verdict.
- **Bridges**: signals file + cTrader cBot (C#) and MT4/MT5 EA (MQL) that display the ticket inside the platform for the trader to confirm.

### v2 (Pro / commercial)
- Licensing (Free / Pro / Tester keys) via a license service (Lemon Squeezy / Keygen).
- Direct platform APIs (cTrader Open API, MetaApi, Alpaca) — per-order confirmation always.
- Licensed real-time data provider (swappable data layer).
- Server-side features (AI proxy, data) that can't be copied from the public repo.
- Multi-ticker auto-scan schedules, backtest reports.

### Out of scope (all versions unless revisited)
- Fully automatic order placement without a human yes.
- Options, margin, shorting (unless enabled by the skills' config).
- High-frequency / tick-level trading.

## 5. Licence tiers (design now, build in v2)

| Tier | How | Gets |
|---|---|---|
| Free | No key | Everything in v1.0 / v1.1 |
| Pro | Paid key | v2 features |
| Tester | Expiring, revocable key you issue | Everything in Pro, time-limited |

One installer; features gated by flags. Public repo = Free core + demo. Pro modules in a private repo.

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| OS | Windows 10/11 x64 |
| Install | Single installer, no separate Python install needed |
| Startup | < 3 s to Dashboard on a typical laptop |
| UI responsiveness | Interactions < 100 ms; skill runs show progress and never freeze the UI |
| Offline | Demo mode and history work offline |
| Security | Secrets in Windows Credential Manager; no telemetry by default; no keys in logs |
| Accessibility | WCAG AA contrast on all presets; full keyboard navigation; never colour alone for meaning |
| i18n | 100 % of UI strings in `en` and `es`; no hard-coded text |
| Quality | Unit + E2E tests in CI; skills' own test suite runs in CI |

## 7. Data & legal constraints

- Free data (Yahoo, SEC, Nasdaq Trader, House Clerk) is delayed/unofficial; Yahoo is **not licensed for commercial use** → the paid tier needs a licensed provider.
- Keep the MIT licence notice of day-trader-skill (NOTICE file + About screen).
- Selling signals can be regulated in some countries; Levelset is positioned as a tool the user runs, not a signal service.
- Disclaimer: not financial advice; most day traders lose money.

## 8. Success criteria for v1.0

1. From launch, a ready ticket's entry/SL/TP is readable within 2 seconds without hunting.
2. A ticket's levels can be copied into cTrader in under 10 seconds.
3. The TSLA 2026-10-19 example reproduces the skills' published numbers exactly in the Pipeline.
4. The whole UI switches EN ↔ ES and between all 7 presets with no untranslated strings or contrast failures.
5. Demo mode is live on GitHub Pages.

## 9. Open questions

1. Day P/L in v1: manual fill entry only (no broker link) — OK?
2. Account currency: USD only in v1, or also show in a second currency (e.g. MXN/EUR)?
3. Public repo licence for the Levelset core: MIT (max portfolio reach) vs AGPL (discourages closed commercial forks)?
4. Should the folder move out of OneDrive before coding? (OneDrive syncing `node_modules` and Rust `target/` folders is slow and can lock files — recommended: `C:\dev\Levelset`, with git + GitHub as backup.)
