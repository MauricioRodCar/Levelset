# Levelset — project briefing for Claude

Windows desktop trading cockpit over the 11 day-trader skills (github.com/Jakeschincariol/day-trader-skill, MIT, vendored). Owner: Mauricio (trades on Pepperstone cTrader; speaks Spanish and English). Public repo: github.com/MauricioRodCar/Levelset. Web demo: mauriciorodcar.github.io/Levelset. Released: v0.1.0.

## Read before working
- docs/PRD.md (v1.0 scope, shipped) · docs/V1.1-PRD.md (current plan + decisions in §9) · docs/ARCHITECTURE.md · docs/SCREENS.md
- docs/api/openapi.yaml — the engine/UI contract. Additive changes only; run `npm run api:types` in app/ after editing, and update the mock.
- CONTRIBUTING.md, app/README.md (UI conventions), engine/README.md, engine/packaging/README.md

## Layout
- `engine/` Python 3.14 FastAPI engine (`levelset_engine/`), tests in `engine/tests/`, venv `engine/.venv`
- `engine/vendor/day-trader-skill/` — vendored skills. **Never edit**; wrap them in `levelset_engine/`.
- `app/` Tauri 2 + React 18 + TS + Tailwind; features in `app/src/features/<name>/`; mock engine in `app/src/api/mock/`; Rust shell in `app/src-tauri/` (engine sidecar, secrets in Credential Manager)
- `shared/themes/*.json` — 7 theme presets
- `.github/workflows/` — ci.yml, release.yml (tag v*), pages.yml

## Non-negotiable rules
- **Never add code that sends orders to a broker.** Levelset shows tickets; the user places trades (bridges only display a ticket in the platform for the user to confirm).
- **Ticket levels** (entry / stop loss / take profit): largest text on the card, neutral `--ls-text` colour, order Entry → Stop loss → Take profit; profit/loss colour only on small markers. Use `<TicketLevels>`.
- **No raw colours** in components (lint enforces); theme tokens only. All presets must pass WCAG AA (contrast test).
- **No hard-coded UI text**; every key in both `en` and `es` (neutral Latin American Spanish). `npm run i18n:check` must pass.
- **AI** explains and coaches; it never makes buy/sell calls or price predictions.
- **Monetization, pricing and business strategy are private**: they live in C:\dev\Levelset-private\MONETIZATION.md. Never put them in this public repo.
- Commit messages end with the Co-Authored-By line given by the harness. Don't push without the owner asking.

## Commands
- Engine: `cd engine; .venv\Scripts\python -m pytest -q` · run: `.venv\Scripts\python -m levelset_engine --port 8765 --token dev --demo`
- Skills suite: `cd engine; .venv\Scripts\python -m unittest discover -s vendor\day-trader-skill\tests`
- App: `cd app; npm run typecheck; npm run lint; npm test; npm run i18n:check; npm run build` · mock UI: `npm run dev:mock`
- Rust: `cd app\src-tauri; cargo check` (prepend %USERPROFILE%\.cargo\bin to PATH)
- Installer: `cd app; npm run build:engine; npm run tauri:build`
- Screenshots: `npm run dev:mock -- --port 5174` then `node scripts/screenshots.mjs`

## Working style the owner wants
- Plan first; no code until the owner approves the requirements. Ask with clear options and a recommendation.
- Delegate larger work packages to subagents with clear file ownership; fewer, larger packages (each subagent re-reads the docs).
- Demo mode must keep reproducing the TSLA 2026-10-19 example exactly (8 shares, 364.18 / 358.32 / 370.04, time machine 29.4 / 25.5 / 45.1).
