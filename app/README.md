# Levelset app (Tauri 2 + React 18 + TypeScript)

The desktop UI. Talks to the local engine over HTTP + SSE (contract: `../docs/api/openapi.yaml`).
Read `../CONTRIBUTING.md` first.

## Commands

| Command                                           | What it does                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install`                                     | install dependencies                                                                                                                                            |
| `npm run dev`                                     | Vite dev server on http://localhost:1420 against the real engine (`VITE_ENGINE_URL`, default `http://127.0.0.1:8765`, token `VITE_ENGINE_TOKEN`, default `dev`) |
| `npm run dev:mock` (or `VITE_MOCK=1 npm run dev`) | same UI against the in-browser mock engine (demo data, no engine needed)                                                                                        |
| `npm run tauri dev`                               | desktop window (starts `npm run dev` itself). Rust: `%USERPROFILE%\.cargo\bin` on PATH                                                                          |
| `npm run build`                                   | typecheck + production build to `dist/`                                                                                                                         |
| `npm test` / `npm run test:watch`                 | Vitest + Testing Library (uses the MSW mock in Node)                                                                                                            |
| `npm run lint` / `npm run typecheck`              | ESLint (incl. the no-raw-hex rule) / `tsc --noEmit`                                                                                                             |
| `npm run i18n:check`                              | fails if any key is missing in `en` or `es` (plural suffixes and `{{vars}}` checked too)                                                                        |
| `npm run api:types`                               | regenerate `src/api/schema.d.ts` from `../docs/api/openapi.yaml` (`api:check` verifies it is current)                                                           |
| `cd src-tauri && cargo check`                     | check the Rust shell                                                                                                                                            |

Demo build for GitHub Pages (WP6): `VITE_MOCK=1 VITE_ROUTER=hash VITE_BASE=/Levelset/ npm run build`.

Run against the real engine: `cd ..\engine && .venv\Scripts\python -m levelset_engine --port 8765 --token dev --demo`, then `npm run dev`.

## Folder map

```
src/
  main.tsx              entry: bootstrap() then render
  app/                  App, Providers, routes.tsx, bootstrap.ts, uiStore (sidebar/onboarding prefs)
    shell/              AppShell (frame), Sidebar, StatusBar, nav.ts (sidebar items), Logo
  api/                  everything engine-related
    schema.d.ts         GENERATED from openapi.yaml (do not edit)
    types.ts            friendly aliases (Ticket, PipelineRun, Step, ...) + STEP_KEYS + SSE event map
    client.ts           openapi-fetch client (getApi), ApiError, unwrap()
    engine.ts           engine URL/token (Tauri get_engine_info, else VITE_ENGINE_*)
    hooks.ts            one TanStack Query hook per endpoint (useTickets, useStartRun, ...)
    events.ts           useEngineEvents() SSE -> cache; engineEvents.on(...) bus for side effects
    queryKeys.ts        qk.* query keys
    mock/               MSW mock engine: fixtures.ts (TSLA demo), db.ts, handlers.ts, eventBus.ts, browser.ts
  components/           shared building blocks (Card, KpiTile, StatusBadge, CopyButton, PriceValue,
                        EmptyState, ErrorState, Skeleton, Disclaimer*, PageHeader, LanguageSwitch, ComingSoon)
    ticket/TicketLevels the Entry / Stop loss / Take profit blocks (ticket rule lives here)
    ui/                 shadcn-style primitives (button, dialog, tabs, tooltip, form, toaster)
  features/             one folder per screen, index.tsx = default-exported page
    dashboard/          PLACEHOLDER (WP3)
    pipeline/           PLACEHOLDER (WP4)  routes /pipeline and /pipeline/:runId
    alerts/             PLACEHOLDER (WP5)
    connections/        PLACEHOLDER
    settings/           tabs shell; Appearance + Language + About done; tabs/AccountLimitsTab,
                        DataSecTab, AiTab are placeholders (WP5); components/AccountLimitsForm is reusable
    onboarding/         first-run wizard
    analyst/, pelosi/   v1.1 coming-soon pages
  theme/                tokens, presets (from ../shared/themes), apply, contrast (WCAG), io, store, ThemeProvider
  i18n/                 i18next init (index.ts) + useFormat() hook
  locales/{en,es}/      <namespace>.json
  lib/                  format.ts (Intl helpers), prefs.ts (local prefs store), clipboard, env, utils (cn)
  hooks/                useNow, useMarketClock
  test/                 setup.ts, server.ts (setupMockServer), render.tsx (renderApp, renderWithProviders)
src-tauri/              Rust shell: window 1440x900 (min 1180x720), get_engine_info, notification plugin
```

## Conventions (all agents must follow)

### Data

- Use hooks from `@/api` only; never call `fetch` in components. Add new hooks to `api/hooks.ts` with keys in `queryKeys.ts`.
- Live updates arrive via SSE; the shell mounts `useEngineEvents()` once. For side effects (toasts, desktop notifications) use `engineEvents.on('alert.rung', fn)` / `useEngineEvent(...)`. Do not open another EventSource.
- Errors: render `<ErrorState error={q.error} onRetry={q.refetch} />`. Problem codes translate via `errors:codes.<code>`.
- Step `checks` / ticket `riskReasons` codes translate via `pipeline:checks.<code>` and `tickets:riskReasons.<code>`.
- When the contract changes: `npm run api:types`, update the mock (`api/mock/`), run `npm test` (the contract test validates every mock response against openapi.yaml with Ajv).

### Theme tokens (no raw colours)

- Tokens: `bg surface surface2 border text text-muted primary on-primary accent profit loss warning info`.
- Tailwind: `bg-surface`, `text-text-muted`, `border-border`, `bg-primary/10` (opacity works). CSS / inline: `var(--ls-loss)` or `tokenVar('loss')` from `@/theme`. Variables: `--ls-<token>` (`--ls-surface-2`, `--ls-text-muted`, `--ls-on-primary`) plus `--ls-<token>-rgb`.
- ESLint blocks hex literals in `src/components`, `src/features`, `src/app`.
- Never colour alone: pair colour with an icon and a label (`StatusBadge` does this).
- One primary button (`variant="primary"`) per view. Focus: add `focus-ring` to custom interactive elements.
- Numbers: `tabular` class (or `<PriceValue>`), formatted with `useFormat()`.

### Ticket rule

- Use `<TicketLevels entry stop target />` (or `<LevelBlock>`) for every ticket card; don't re-implement it.
- Entry, Stop loss, Take profit are the largest text on the card (`text-level`, 26 px, weight 500, tabular) in `text-text`, never profit/loss colours.
- Stop/target identity only via the 3 px top bar + small dot in `loss`/`profit`; entry is neutral.
- Order always Entry -> Stop loss -> Take profit. Clicking a value copies it (`priceForCopy`, dot decimal) and toasts "Copied 358.32".
- Secondary line (max loss, R, odds, flat-by, risk badge) is 12 px `text-text-muted`. See `features/settings/appearance/SampleTicketCard.tsx`.

### i18n

- No hard-coded UI strings. `const { t } = useTranslation('<namespace>')`; other namespaces with `t('common:actions.save')`.
- Adding a key: add it to `src/locales/en/<ns>.json` AND `src/locales/es/<ns>.json`, then `npm run i18n:check`. New namespace: create both files and add the name to `NAMESPACES` in `src/i18n/index.ts`.
- Plurals: `key_one` / `key_other` (Spanish also `key_many`), call with `{ count }`.
- Spanish: neutral Latin American, "tú", natural phrasing. Trading terms stay as traders use them: "Stop loss", "Take profit", "Entrada", ticker, watchlist, setup.
- Money / numbers / dates: `useFormat()` (`f.money`, `f.price`, `f.percent`, `f.marketTime`, `f.marketDate`). Market times are always New York with "ET"; API `HH:MM` strings via `f.etClock`.
- Licence texts and free text from skills / news stay in their original language.

### Local preferences

- `prefs` from `@/lib/prefs` (keys in `PREF_KEYS`). Backed by localStorage today; swap the backend (`setPrefsBackend`) for the Tauri store later. Never store secrets there.

### Tests

- Vitest + Testing Library next to the code (`*.test.ts(x)`). `setupMockServer()` gives you the mock engine; `renderApp('/path')` renders the whole app, `resetAppState()` resets prefs/theme/language.

### Adding a page

1. `src/features/<name>/index.tsx` with a default-exported page component.
2. Route in `src/app/routes.tsx`, sidebar entry in `src/app/shell/nav.ts`, label in `shell:nav.<name>` (en + es).
