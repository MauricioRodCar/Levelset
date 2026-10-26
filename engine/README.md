# Levelset engine (WP1)

Local FastAPI engine that wraps the vendored day-trader skills
(`vendor/day-trader-skill`, MIT, read-only). It implements `docs/api/openapi.yaml`
and never places a broker order.

## Setup

```powershell
cd C:\dev\Levelset\engine
C:\Python314\python.exe -m venv .venv
.venv\Scripts\pip install -e .[dev]
```

## Run

```powershell
# demo: offline fixtures, clock pinned to Mon 2026-10-19 10:15 ET
.venv\Scripts\python -m levelset_engine --port 8765 --token dev --demo

# live (free Yahoo/SEC data), default workspace %APPDATA%\Levelset\workspace
.venv\Scripts\python -m levelset_engine --port 8765 --token <token>
```

| flag | default |
| --- | --- |
| `--port` | 8765 (`0` picks a free port) |
| `--token` | `LEVELSET_TOKEN`, else `dev` |
| `--workspace` | `%APPDATA%\Levelset\workspace` (demo: `...\workspace\demo`) |
| `--demo` | off |

Once it is listening it prints one line on stdout, `LEVELSET_ENGINE_READY port=<p>`,
and binds `127.0.0.1` only. Every endpoint except `/health` needs
`Authorization: Bearer <token>`; `/events` (SSE) also accepts `?token=`.
Errors are `application/problem+json` with a stable `code`. In demo mode the
Swagger UI is at `/docs`.

## Test

```powershell
.venv\Scripts\python -m pytest -q                                               # engine
.venv\Scripts\python -m unittest discover -s vendor\day-trader-skill\tests      # the skills' own suite
```

The engine tests validate every response against `docs/api/openapi.yaml`
(JSON Schema plus no undeclared properties) and check the README TSLA numbers
end to end.

## How it works

```
levelset_engine/
  __main__.py        CLI, ready line, multiprocessing.freeze_support() for PyInstaller
  config.py clock.py EngineConfig; New York time without tz files; demo clock pin
  context.py         EngineContext: workspace, SQLite, skill runner, calendar, event bus, lock
  runner/            one spawned process per skill call: chdir(workspace), load the script by
                     path, main([...args, "--json"]), capture stdout/stderr/exit code, timeout
  pipeline/          the 8 steps (steps.py), run-all / step mode (service.py), tickets, codes
  services/          status/watchlist/news/scans (market.py), fills/trades/dashboard
                     (trading.py), alerts + 30 s live check loop (alerts.py)
  adapters/          settings <-> trader/config.json, ticket exports, NYSE calendar
  storage/           SQLite (runs, steps, tickets, fills, alerts) and the trader/ files
  api/               Pydantic models (camelCase), routes, auth, problem+json errors
```

- **Skills, as their SKILL.md describe them**: `scan.py orb`, `news.py --tickers`,
  `entry.py check T --setup orb --write`, `exit.py plan --stop or-mid --target 1R --write`,
  `timemachine.py run --write`, `size.py --write`, `check.py`, `ticket.py show`;
  alerts via `alerts.py check`/`quote`, manual fills via `ticket.py fill`.
- **Per-run isolation**: after each step the engine snapshots the per-trade files
  (`watchlist`, `entry`, `plan`, `timemachine`, `orders`, `state/risk`) into SQLite and
  restores the run's snapshot before its next step, so concurrent runs never mix files.
- **Demo mode**: skills get `--offline <vendor fixtures>` and `--now "2026-10-19 10:15"`;
  the worker also disables `urllib`/sockets (and the skills' `_urlopen` seam), so a
  demo can never touch the network.
- **Settings** map to the skills' `trader/config.json` keys (`budget`, `cash_buffer_pct`,
  `max_loss_per_trade_usd`, `max_daily_loss_usd`, `max_trades_per_day`, `min_reward_risk`,
  `max_position_pct`, `max_order_usd`, `no_entries_before`, `no_entries_after`, `flat_by`,
  `require_stop`, `pdt_guard`, `paper`, `sec_user_agent`); other keys are preserved.
- **Vendor path** resolves from `LEVELSET_VENDOR_DIR`, else `sys._MEIPASS/vendor/day-trader-skill`
  when frozen, else `engine/vendor/day-trader-skill`. Bundle the vendor folder (including
  `tests/fixtures` for demo mode) at `vendor/day-trader-skill` inside the PyInstaller build.
