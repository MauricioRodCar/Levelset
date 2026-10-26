# Working on Levelset

Read first: docs/PRD.md, docs/ARCHITECTURE.md, docs/SCREENS.md, docs/api/openapi.yaml.

## Rules for every contributor (human or agent)
- **The API contract is docs/api/openapi.yaml.** Don't change it on your own; propose changes in your report.
- **Don't edit engine/vendor/**. Wrap skills in engine/levelset_engine instead.
- **Stay in your folders.** Each work package owns specific paths; don't touch others.
- **Don't commit.** The lead reviews and commits.
- **No hard-coded UI text.** Every string goes through i18n with keys in both `en` and `es`.
- **No raw colours in components.** Use theme tokens (CSS variables `--ls-<token>`) from shared/themes.
- **Ticket levels (entry / stop loss / take profit)** always render in `--ls-text`, ≥ 24 px, tabular numerals. Profit/loss colours only on small markers.
- Never add code that places orders with a broker.
- Tests ship with the code: pytest for engine, Vitest for app.

## Layout
- engine/            Python FastAPI engine (levelset_engine/, tests/, vendor/)
- app/               Tauri 2 + React + TS (src/, src-tauri/)
- shared/themes/     theme presets (JSON, tokens: bg surface surface2 border text textMuted primary onPrimary accent profit loss warning info)
- docs/              specs

## Dev commands
- Engine: `cd engine && python -m venv .venv && .venv\Scripts\pip install -e .[dev] && .venv\Scripts\python -m levelset_engine --port 8765 --demo`
- App: `cd app && npm install && npm run dev` (browser) or `npm run tauri dev` (desktop)
