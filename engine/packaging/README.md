# Engine packaging (WP6)

Builds `levelset-engine.exe` with PyInstaller and stages it as the Tauri sidecar.

```powershell
# from the repo root
powershell -ExecutionPolicy Bypass -File engine\packaging\build.ps1           # venv + build + smoke test + stage
powershell -ExecutionPolicy Bypass -File engine\packaging\build.ps1 -NoStage  # build + smoke test only
cd app; npm run tauri:build                                                   # NSIS installer (needs the staged engine)
```

| file | what |
| --- | --- |
| `levelset-engine.spec` | PyInstaller spec (one-folder, console subsystem, runtime in `engine-runtime\`) |
| `engine_entry.py` | frozen entry: `multiprocessing.freeze_support()` then `levelset_engine.__main__.main()` |
| `build.ps1` | build-only venv at `engine\packaging\.venv`, PyInstaller 6.22.3, smoke test, staging |
| `smoke_test.py` | starts the exe with `--demo --port 0`, waits for the ready line, `/health`, TSLA pipeline, checks the ticket (8 x TSLA, 364.18 / 358.32 / 370.04) |

Output: `engine\packaging\dist\levelset-engine\levelset-engine.exe` plus `engine-runtime\`
(Python 3.14 runtime, FastAPI/uvicorn/pydantic, and `vendor\day-trader-skill` including
`tests\fixtures` for demo mode). About 33 MB on disk.

## Decisions

- **Python / PyInstaller**: PyInstaller 6.22.3 supports Python 3.14, so the build uses the same
  Python as development (`py -3`, or pass `-Python "py -3.12"`). The build venv is separate from
  the dev venv `engine\.venv`.
- **One-folder, not one-file.** Every skill call runs in a fresh `multiprocessing` spawn worker,
  which re-launches the exe. A one-file exe unpacks ~30 MB to `%TEMP%` at startup and adds a
  bootloader process to every launch; one-folder starts in about 1.5 s to the ready line and a
  full demo pipeline (8 skill workers) takes about 3 s. The runtime folder is named
  `engine-runtime` (not PyInstaller's default `_internal`) because the installer puts it next
  to `Levelset.exe`.
- **Console subsystem + CREATE_NO_WINDOW.** A console exe keeps stdout as a real pipe, so the
  ready line is reliable. The Tauri shell starts it with `CREATE_NO_WINDOW`, so no window shows,
  and the multiprocessing workers inherit that hidden console instead of opening their own.
  (A windowed exe would have no stdio for the workers to inherit.)
- **Skill imports**: the skills are loaded by path at runtime, so PyInstaller cannot see their
  imports. The spec parses every `trader-*/*.py` with `ast` and adds the stdlib modules they
  import as hidden imports.

## How the Tauri shell ships and runs it

- `build.ps1` copies the exe to `app\src-tauri\binaries\levelset-engine-<target-triple>.exe`
  (Tauri `externalBin` naming, e.g. `x86_64-pc-windows-msvc`) and the runtime folder to
  `app\src-tauri\engine-runtime\` (both gitignored).
- `app\src-tauri\tauri.release.conf.json` adds `externalBin` + `resources` and is merged only by
  `npm run tauri:build`. The base `tauri.conf.json` does not reference them, so `cargo check`,
  `npm run tauri dev` and CI work without a built engine.
- At startup `src-tauri\src\engine.rs` runs `levelset-engine.exe --port 0 --token <random 32-byte hex>
  --workspace <app data>\workspace`, waits up to 20 s for `LEVELSET_ENGINE_READY port=<p>` and
  serves url + token through `get_engine_info`. See that file's header for the dev fallbacks
  (`LEVELSET_ENGINE_URL`, or `engine\.venv` python in debug builds), demo mode and the Job Object
  that kills the engine and its workers when the app exits or crashes.
