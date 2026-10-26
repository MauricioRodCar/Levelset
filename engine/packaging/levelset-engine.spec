# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for levelset-engine (one-folder build).
#
#   powershell -File engine\packaging\build.ps1      (preferred: venv + build + smoke test)
#   pyinstaller --noconfirm engine\packaging\levelset-engine.spec --distpath ... --workpath ...
#
# Output: dist\levelset-engine\levelset-engine.exe + dist\levelset-engine\engine-runtime\
# (Python runtime, libraries and vendor\day-trader-skill). See engine\packaging\README.md
# for why one-folder and how the Tauri shell ships it.

import ast
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

HERE = Path(SPECPATH).resolve()          # engine/packaging
ENGINE = HERE.parent                     # engine/
VENDOR = ENGINE / "vendor" / "day-trader-skill"
if not (VENDOR / "trader-exit" / "exit.py").exists():
    raise SystemExit("vendored skills not found at %s" % VENDOR)

# The skills are loaded by path at runtime (importlib), so PyInstaller cannot see what
# they import. Parse every skill script and add the stdlib modules they use.
def skill_imports() -> list[str]:
    names: set[str] = set()
    for py in VENDOR.glob("trader-*/*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"), filename=str(py))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                names.add(node.module)
    stdlib = set(sys.stdlib_module_names)
    return sorted(n for n in names if n.split(".")[0] in stdlib)


hiddenimports = (
    skill_imports()
    + collect_submodules("levelset_engine")
    + collect_submodules("uvicorn")      # loops/protocols/lifespan are picked by string
    + ["email.mime.text", "email.mime.multipart", "html.parser", "zlib", "csv", "statistics"]
)

a = Analysis(
    [str(HERE / "engine_entry.py")],
    pathex=[str(ENGINE)],
    binaries=[],
    # vendor tree (skills + tests/fixtures for demo mode) at vendor/day-trader-skill
    datas=[(str(VENDOR), "vendor/day-trader-skill")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "pytest", "jsonschema", "yaml", "IPython", "matplotlib", "numpy"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="levelset-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # Console subsystem keeps stdout/stderr real pipes (the ready line). The Tauri shell
    # spawns it with CREATE_NO_WINDOW, so no window appears, and the multiprocessing
    # workers inherit that hidden console instead of flashing their own.
    console=True,
    disable_windowed_traceback=False,
    icon=str(ENGINE.parent / "app" / "src-tauri" / "icons" / "icon.ico"),
    # one-folder layout: put the runtime in a uniquely named subfolder (default "_internal")
    # because the Tauri bundle drops it next to Levelset.exe.
    contents_directory="engine-runtime",
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="levelset-engine",
)
