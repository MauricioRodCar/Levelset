# Levelset — Architecture (v0.1, draft for sign-off)

## 1. Overview

```
┌──────────────────────── Levelset.exe (Tauri 2) ────────────────────────┐
│                                                                        │
│  UI (WebView2)  React + TS + Tailwind + shadcn/ui                      │
│   ├─ Dashboard · Pipeline · Alerts · Settings (· Analyst · Pelosi)     │
│   ├─ Theme engine (CSS variables)   ├─ i18n (react-i18next: en, es)    │
│   └─ API client (TanStack Query) ──── HTTP + SSE on 127.0.0.1:<port> ──┐│
│                                                                       ││
│  Rust shell (thin): window, tray, notifications, secure storage,      ││
│  starts/stops the engine sidecar, passes it a random port + token     ││
└───────────────────────────────────────────────────────────────────────┼┘
                                                                        │
┌──────────── levelset-engine.exe (Python 3.12, PyInstaller) ───────────▼┐
│  FastAPI                                                                │
│   ├─ /skills/*      one router per skill                                │
│   ├─ /pipeline/*    run all / step, run history                         │
│   ├─ /tickets       ready + blocked tickets, export                     │
│   ├─ /alerts        CRUD + check loop → SSE events                      │
│   ├─ /settings      reads/writes the skills' config files               │
│   └─ /events (SSE)  progress, alerts, run updates                       │
│  Skill runner: worker process pool → imports vendored skill module,     │
│                calls main([... "--json"]) with cwd = workspace          │
│  Adapters: MarketData · Platform (export / bridge / direct) · License   │
│  Storage: SQLite (runs, tickets, alerts, fills) + skills' trader/ files │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. Tech choices

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** | ~10 MB shell vs ~150 MB Electron, low RAM, native notifications, sidecar support |
| UI | React 18, TypeScript, Vite | Largest ecosystem; same code for desktop, web demo and a future SaaS |
| Styling | Tailwind CSS + shadcn/ui (Radix) | Accessible primitives, fully themeable through CSS variables |
| Charts | TradingView Lightweight Charts | Purpose-built financial charts, small, Apache-2.0 |
| State | TanStack Query (server state), Zustand (UI state) | Simple, cache + retries built in |
| i18n | react-i18next + `Intl` | Plurals, interpolation, locale number/date formats |
| Engine | Python 3.12 + FastAPI + Uvicorn | The skills are Python; zero rewrite |
| Packaging | PyInstaller (engine) as Tauri sidecar; Tauri bundler → NSIS installer | One installer, no Python needed on the user's machine |
| Storage | SQLite (engine) | Local, zero-config |
| Secrets | Windows Credential Manager via Tauri plugin (`keyring`) | Never in plain files |
| Tests | Vitest + Testing Library, Playwright (E2E), pytest | |
| CI | GitHub Actions: lint, tests, skills test suite, build installer, deploy demo to Pages | |

## 3. How the skills are wrapped

- The skills repo is vendored at `engine/vendor/day-trader-skill/` (git subtree, pinned commit, MIT notice kept). **We do not modify skill code**; fixes go upstream or into thin wrappers.
- Every skill script exposes `main(argv)` and a `--json` flag (verified). The engine imports the module and calls `main([...args, "--json"])`, capturing stdout as JSON.
- Skills read/write files relative to cwd (`trader/plan.json`, `trader/orders.json`, `trader/state/*.json`). cwd is process-global, so each run executes in a **worker process** (multiprocessing pool, `freeze_support` for PyInstaller) whose cwd is the user workspace `%APPDATA%\Levelset\workspace\`.
- The engine reads the files a step wrote and stores a snapshot per step in SQLite → this is the Pipeline's input/output audit trail.
- `--now` is passed in demo mode to pin the clock to the fixtures' date.

## 4. Pipeline model

```
PipelineRun { id, ticker?, setup, mode: step|all, started_at, status, steps[] }
Step        { key: scanner|news|entry|exit|timemachine|budget|risk|ticket,
              status: pending|running|done|check|blocked|error,
              params, inputs (snapshot), outputs (snapshot), summary, started_at, ended_at }
Ticket      { id, run_id, symbol, side, qty, entry, stop, target, max_loss, r,
              tm_verdict, risk_verdict, risk_reasons[], flat_by, created_at }
```

`check` = finished but needs attention (e.g. earnings this week, coin-flip odds).

## 5. Adapters (keeps the product generic and monetizable)

```ts
interface MarketDataProvider { quote(); bars(symbol, interval, range); } // v1: skills' built-in Yahoo; v2: licensed provider
interface PlatformAdapter   { id; name; capabilities: ('export'|'bridge'|'direct')[]; formatTicket(t); send?(t, confirmation) }
interface LicenseProvider   { tier(): 'free'|'pro'|'tester'; features(): Set<Feature>; expiresAt? }
```

- v1 platform adapters: `clipboard`, `csv`, `json`, plus how-to cards for cTrader / MT4 / MT5.
- v1.1: `ctrader-bridge` (signals file → cBot), `mt-bridge` (signals file → EA).
- v2: `ctrader-openapi`, `metaapi`, `alpaca`. `send()` requires a confirmation token created by an explicit user click for that exact ticket.
- `LicenseProvider` v1 = always `free`, all v1 features on. Feature checks exist from day one so gating later is a config change.

## 6. Theme engine

- Semantic tokens only — components never use raw hex:
  `bg, surface, surface-2, border, text, text-muted, primary, on-primary, accent, profit, loss, warning, info`.
- A theme is a JSON file `{ id, name, mode: dark|light, tokens: {...} }` mapped to CSS variables on `:root`.
- Presets: Navy + Teal (default), Daylight (light), Graphite + Emerald, Midnight + Gold, Monochrome, Colour-blind safe (blue/orange), High contrast.
- Custom themes: per-token pickers, live preview on a sample ticket, import/export JSON, automatic WCAG AA contrast check for text tokens against their backgrounds.
- **Ticket rule enforced in components:** level values always use `text`; `profit`/`loss` only on markers.

## 7. i18n

- `app/src/locales/{en,es}/*.json` namespaced by screen. Keys only in code.
- CI check fails on missing keys in any locale.
- `Intl.NumberFormat` / `DateTimeFormat` follow the UI locale; market times rendered in `America/New_York` with "ET".
- Skill output text (English) is mapped to translated labels via structured fields; free-text from skills/news stays original.

## 8. Security & privacy

- Engine listens only on 127.0.0.1 with a random port and a per-launch bearer token from the shell.
- Secrets (Claude key, future broker keys) in Credential Manager; engine receives them per request, never logs them.
- No telemetry. Outbound calls only to the skills' public data endpoints (and Anthropic API if AI is enabled).

## 9. Repository layout

```
Levelset/
├─ app/                    Tauri + React
│  ├─ src/ (components, features/{dashboard,pipeline,tickets,alerts,settings}, theme, locales, api)
│  └─ src-tauri/           Rust shell, sidecar config
├─ engine/                 FastAPI engine
│  ├─ levelset_engine/     (api, runner, adapters, storage)
│  ├─ vendor/day-trader-skill/
│  └─ tests/
├─ demo/                   web-demo build config (mock engine on fixtures)
├─ docs/                   PRD, ARCHITECTURE, SCREENS, ADRs
├─ .github/workflows/
├─ LICENSE  NOTICE  README.md
```

## 10. Build plan (for delegation after sign-off)

Step 0 (me, sequential): repo scaffold, **API contract (OpenAPI)**, design tokens, i18n skeleton. These unblock parallel work.

| WP | Work package | Depends on | Parallel? |
|---|---|---|---|
| 1 | Engine: skill runner, pipeline, tickets, settings, SQLite, SSE, tests | Step 0 | yes |
| 2 | UI foundation: app shell, sidebar, status bar, theme engine + 7 presets, i18n EN/ES, onboarding | Step 0 | yes |
| 3 | Dashboard + ticket card + copy/export + platform how-to | 2 (shell), contract | yes, after 2's shell |
| 4 | Pipeline view: step cards, detail panels, wizard / run all, history | 2 (shell), contract | yes, after 2's shell |
| 5 | Alerts + Settings pages + notifications | 2, contract | yes |
| 6 | Packaging (PyInstaller sidecar, NSIS installer), demo build to GitHub Pages, CI | 1, 2 | last |
| 7 | Integration + E2E tests, EN/ES and theme audit, TSLA example verification | all | last |

Each WP goes to its own subagent with this doc, the PRD, SCREENS and the API contract; UI WPs touch separate `features/*` folders to avoid conflicts.
