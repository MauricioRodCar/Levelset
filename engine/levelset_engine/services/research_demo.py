"""Offline fixtures for the Analyst and Congress pages in demo mode.

trader-analyst reads --offline DIR (company_tickers.json, companyfacts-CIK*.json,
submissions-CIK*.json, <accession>/index.json). The vendored tests ship Apple
and Coca-Cola; the demo is about TSLA, so this module writes a TSLA sample in
the same SEC shape next to copies of the vendored files, under
<workspace>/demo-data/analyst. The TSLA numbers are a demo sample shaped like
Tesla's reports, not a copy of its filings. trader-pelosi reads the vendored
2026FD.zip index and the `pdftotext -layout` text of four PTRs.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

ANALYST_DIR = "demo-data/analyst"
TSLA_CIK = "0001318605"

# (start, end, fy, fp, form, filed, accession, revenue, gross, operating, net, eps diluted)
_TSLA_PERIODS: list[tuple[str, str, int, str, str, str, str, float, float, float, float, float]] = [
    ("2024-01-01", "2024-03-31", 2024, "Q1", "10-Q", "2024-04-24", "0000950170-24-046895",
     21.301e9, 3.696e9, 1.171e9, 1.129e9, 0.34),
    ("2024-04-01", "2024-06-30", 2024, "Q2", "10-Q", "2024-07-24", "0000950170-24-086427",
     25.500e9, 4.578e9, 1.605e9, 1.478e9, 0.42),
    ("2024-07-01", "2024-09-30", 2024, "Q3", "10-Q", "2024-10-24", "0001628280-24-043486",
     25.182e9, 5.005e9, 2.717e9, 2.167e9, 0.62),
    ("2024-01-01", "2024-12-31", 2024, "FY", "10-K", "2025-01-30", "0001628280-25-003063",
     97.690e9, 17.450e9, 7.076e9, 7.091e9, 2.04),
    ("2025-01-01", "2025-03-31", 2025, "Q1", "10-Q", "2025-04-23", "0001628280-25-018911",
     19.335e9, 3.153e9, 0.399e9, 0.409e9, 0.12),
    ("2025-04-01", "2025-06-30", 2025, "Q2", "10-Q", "2025-07-24", "0001628280-25-035806",
     22.496e9, 3.878e9, 0.923e9, 1.172e9, 0.33),
    ("2025-07-01", "2025-09-30", 2025, "Q3", "10-Q", "2025-10-23", "0001628280-25-045968",
     28.095e9, 5.054e9, 1.624e9, 1.373e9, 0.39),
    ("2025-01-01", "2025-12-31", 2025, "FY", "10-K", "2026-01-29", "0001628280-26-003952",
     94.827e9, 17.095e9, 4.355e9, 3.794e9, 1.08),
    ("2026-01-01", "2026-03-31", 2026, "Q1", "10-Q", "2026-04-23", "0001628280-26-026113",
     22.380e9, 4.120e9, 0.910e9, 0.720e9, 0.20),
    ("2026-04-01", "2026-06-30", 2026, "Q2", "10-Q", "2026-07-24", "0001628280-26-045311",
     24.870e9, 4.650e9, 1.270e9, 1.390e9, 0.39),
]

# newest first, like SEC's filings.recent arrays: (form, filed, report period, accession, primary doc, items)
_TSLA_FILINGS: list[tuple[str, str, str, str, str, str]] = [
    ("10-Q", "2026-07-24", "2026-06-30", "0001628280-26-045311", "tsla-20260630.htm", ""),
    ("8-K", "2026-07-23", "", "0001628280-26-045001", "tsla-20260723.htm", "2.02,9.01"),
    ("10-Q", "2026-04-23", "2026-03-31", "0001628280-26-026113", "tsla-20260331.htm", ""),
    ("8-K", "2026-04-22", "", "0001628280-26-025870", "tsla-20260422.htm", "2.02,9.01"),
    ("10-K", "2026-01-29", "2025-12-31", "0001628280-26-003952", "tsla-20251231.htm", ""),
]
_EX991 = "tsla-ex991_q22026.htm"


def _fact(p: tuple[Any, ...], val: float) -> dict[str, Any]:
    start, end, fy, fp, form, filed, accn = p[:7]
    return {"start": start, "end": end, "val": val, "accn": accn, "fy": fy, "fp": fp, "form": form, "filed": filed}


def tsla_companyfacts() -> dict[str, Any]:
    concepts = {"Revenues": 7, "GrossProfit": 8, "OperatingIncomeLoss": 9, "NetIncomeLoss": 10}
    gaap: dict[str, Any] = {}
    for concept, col in concepts.items():
        gaap[concept] = {"units": {"USD": [_fact(p, round(p[col])) for p in _TSLA_PERIODS]}}
    gaap["EarningsPerShareDiluted"] = {"units": {"USD/shares": [_fact(p, p[11]) for p in _TSLA_PERIODS]}}
    return {"cik": int(TSLA_CIK), "entityName": "Tesla, Inc.", "facts": {"us-gaap": gaap}}


def tsla_submissions() -> dict[str, Any]:
    cols: dict[str, list[str]] = {"form": [], "filingDate": [], "reportDate": [], "accessionNumber": [],
                                  "primaryDocument": [], "items": []}
    for form, filed, period, acc, doc, items in _TSLA_FILINGS:
        for k, v in zip(cols, (form, filed, period, acc, doc, items)):
            cols[k].append(v)
    return {"cik": TSLA_CIK, "name": "Tesla, Inc.", "tickers": ["TSLA"], "filings": {"recent": cols}}


def _write(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh)


def prepare_analyst(fixtures: Path, dst: Path) -> Path:
    """Fill dst with the vendored analyst fixtures plus the TSLA sample (idempotent)."""
    if (dst / ("companyfacts-CIK%s.json" % TSLA_CIK)).is_file():
        return dst
    src = fixtures / "trader-analyst"
    if src.is_dir():
        shutil.copytree(src, dst, dirs_exist_ok=True)
    dst.mkdir(parents=True, exist_ok=True)
    tickers_path = dst / "company_tickers.json"
    tickers: dict[str, Any] = {}
    if tickers_path.is_file():
        with open(tickers_path, encoding="utf-8") as fh:
            tickers = json.load(fh)
    tickers[str(len(tickers) + 100)] = {"cik_str": int(TSLA_CIK), "ticker": "TSLA", "title": "Tesla, Inc."}
    _write(tickers_path, tickers)
    _write(dst / ("submissions-CIK%s.json" % TSLA_CIK), tsla_submissions())
    acc = _TSLA_FILINGS[1][3]
    _write(dst / acc.replace("-", "") / "index.json",
           {"directory": {"item": [{"name": _TSLA_FILINGS[1][4]}, {"name": _EX991}, {"name": acc + "-index.htm"}]}})
    _write(dst / ("companyfacts-CIK%s.json" % TSLA_CIK), tsla_companyfacts())
    return dst


# ---------------------------------------------------------------- congress

PELOSI_INDEX = "trader-pelosi/2026FD.zip"
# DocID -> the vendored pdftotext output; every other PTR in the index stays "unread" (no pdftotext offline)
PELOSI_TEXTS = {
    "20033725": "trader-pelosi/ptr-20033725-excerpt.txt",
    "20035143": "trader-pelosi/ptr-20035143.txt",
    "20035562": "trader-pelosi/ptr-20035562-excerpt.txt",
    "20035590": "trader-pelosi/ptr-20035590.txt",
}
