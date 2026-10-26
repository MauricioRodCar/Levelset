"""PyInstaller entry point for levelset-engine.exe.

`levelset_engine.__main__` only calls freeze_support() under `if __name__ == "__main__"`,
which is not the case when it is imported, so the frozen entry calls it itself. In a
frozen build every skill call re-launches this exe as a multiprocessing "spawn" worker;
freeze_support() turns those launches into workers instead of new engines.
"""

import multiprocessing
import sys

if __name__ == "__main__":
    multiprocessing.freeze_support()
    from levelset_engine.__main__ import main

    sys.exit(main())
