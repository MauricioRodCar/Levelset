"""SQLite persistence for runs, steps, tickets, fills, alerts and small key/values."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    ticker TEXT,
    setup TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    ticket_id TEXT,
    params TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS steps (
    run_id TEXT NOT NULL,
    key TEXT NOT NULL,
    idx INTEGER NOT NULL,
    status TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    inputs TEXT NOT NULL DEFAULT '{}',
    outputs TEXT NOT NULL DEFAULT '{}',
    summary TEXT NOT NULL DEFAULT '{}',
    checks TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    started_at TEXT,
    ended_at TEXT,
    files TEXT,
    PRIMARY KEY (run_id, key)
);
CREATE TABLE IF NOT EXISTS tickets (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    run_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fills (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_accounts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_positions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    account_id TEXT NOT NULL,
    period_id TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_positions_account ON paper_positions (account_id, status);
CREATE TABLE IF NOT EXISTS paper_fills (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT UNIQUE NOT NULL,
    position_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bridge_symbol_map (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    us_symbol TEXT NOT NULL,
    data TEXT NOT NULL,
    UNIQUE (platform, us_symbol)
);
"""

STEP_JSON = ("params", "inputs", "outputs", "summary", "checks", "files")


def _dumps(v: Any) -> str:
    return json.dumps(v, separators=(",", ":"))


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _exec(self, sql: str, args: tuple[Any, ...] = ()) -> None:
        with self._lock:
            self._conn.execute(sql, args)
            self._conn.commit()

    def _all(self, sql: str, args: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute(sql, args).fetchall())

    # ---------------------------------------------------------------- runs
    def insert_run(self, run: dict[str, Any]) -> None:
        self._exec("INSERT INTO runs (id, ticker, setup, mode, status, started_at, ended_at, ticket_id, params) "
                   "VALUES (?,?,?,?,?,?,?,?,?)",
                   (run["id"], run.get("ticker"), run["setup"], run["mode"], run["status"], run["started_at"],
                    run.get("ended_at"), run.get("ticket_id"), _dumps(run.get("params") or {})))

    def update_run(self, run_id: str, **fields: Any) -> None:
        if not fields:
            return
        cols = []
        vals: list[Any] = []
        for k, v in fields.items():
            cols.append("%s = ?" % k)
            vals.append(_dumps(v) if k == "params" else v)
        vals.append(run_id)
        self._exec("UPDATE runs SET %s WHERE id = ?" % ", ".join(cols), tuple(vals))

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        rows = self._all("SELECT * FROM runs WHERE id = ?", (run_id,))
        return self._run_row(rows[0]) if rows else None

    def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._all("SELECT * FROM runs ORDER BY seq DESC LIMIT ?", (max(1, int(limit)),))
        return [self._run_row(r) for r in rows]

    @staticmethod
    def _run_row(r: sqlite3.Row) -> dict[str, Any]:
        d = dict(r)
        d["params"] = json.loads(d.get("params") or "{}")
        d.pop("seq", None)
        return d

    # ---------------------------------------------------------------- steps
    def upsert_step(self, run_id: str, step: dict[str, Any]) -> None:
        self._exec("INSERT OR REPLACE INTO steps (run_id, key, idx, status, params, inputs, outputs, summary, "
                   "checks, error, started_at, ended_at, files) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (run_id, step["key"], step["idx"], step["status"], _dumps(step.get("params") or {}),
                    _dumps(step.get("inputs") or {}), _dumps(step.get("outputs") or {}),
                    _dumps(step.get("summary") or {}), _dumps(step.get("checks") or []), step.get("error"),
                    step.get("started_at"), step.get("ended_at"),
                    _dumps(step["files"]) if step.get("files") is not None else None))

    def get_steps(self, run_id: str) -> list[dict[str, Any]]:
        rows = self._all("SELECT * FROM steps WHERE run_id = ? ORDER BY idx", (run_id,))
        out = []
        for r in rows:
            d = dict(r)
            for k in STEP_JSON:
                if d.get(k) is not None:
                    d[k] = json.loads(d[k])
            out.append(d)
        return out

    # ---------------------------------------------------------------- simple JSON tables
    def _put(self, table: str, obj_id: str, created_at: str, data: dict[str, Any], extra: dict[str, Any] | None = None
             ) -> None:
        cols = ["id", "created_at", "data"] + list((extra or {}).keys())
        vals = [obj_id, created_at, _dumps(data)] + list((extra or {}).values())
        self._exec("INSERT OR REPLACE INTO %s (%s) VALUES (%s)" % (table, ", ".join(cols), ",".join("?" * len(cols))),
                   tuple(vals))

    def _get(self, table: str, obj_id: str) -> dict[str, Any] | None:
        rows = self._all("SELECT data FROM %s WHERE id = ?" % table, (obj_id,))
        return json.loads(rows[0]["data"]) if rows else None

    def _list(self, table: str, newest_first: bool = True) -> list[dict[str, Any]]:
        rows = self._all("SELECT data FROM %s ORDER BY seq %s" % (table, "DESC" if newest_first else "ASC"))
        return [json.loads(r["data"]) for r in rows]

    def put_ticket(self, t: dict[str, Any]) -> None:
        self._put("tickets", t["id"], t["createdAt"], t, {"run_id": t["runId"]})

    def get_ticket(self, ticket_id: str) -> dict[str, Any] | None:
        return self._get("tickets", ticket_id)

    def list_tickets(self) -> list[dict[str, Any]]:
        return self._list("tickets")

    def put_fill(self, f: dict[str, Any], created_at: str) -> None:
        self._put("fills", f["id"], created_at, f)

    def list_fills(self, newest_first: bool = True) -> list[dict[str, Any]]:
        return self._list("fills", newest_first)

    def get_fill(self, fill_id: str) -> dict[str, Any] | None:
        return self._get("fills", fill_id)

    def delete_fill(self, fill_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM fills WHERE id = ?", (fill_id,))
            self._conn.commit()
            return cur.rowcount > 0

    def put_alert(self, a: dict[str, Any]) -> None:
        with self._lock:
            rows = self._conn.execute("SELECT seq FROM alerts WHERE id = ?", (a["id"],)).fetchall()
            if rows:
                self._conn.execute("UPDATE alerts SET data = ? WHERE id = ?", (_dumps(a), a["id"]))
            else:
                self._conn.execute("INSERT INTO alerts (id, created_at, data) VALUES (?,?,?)",
                                   (a["id"], a["createdAt"], _dumps(a)))
            self._conn.commit()

    def get_alert(self, alert_id: str) -> dict[str, Any] | None:
        return self._get("alerts", alert_id)

    def list_alerts(self) -> list[dict[str, Any]]:
        return self._list("alerts")

    def delete_alert(self, alert_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
            self._conn.commit()
            return cur.rowcount > 0

    # ---------------------------------------------------------------- kv
    def kv_get(self, key: str, default: Any = None) -> Any:
        rows = self._all("SELECT value FROM kv WHERE key = ?", (key,))
        return json.loads(rows[0]["value"]) if rows else default

    def kv_set(self, key: str, value: Any) -> None:
        self._exec("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (key, _dumps(value)))

    # ---------------------------------------------------------------- paper (WP1; rows in paper/store.py)
    def set_ticket_paper(self, ticket_id: str, paper: dict[str, Any]) -> bool:
        """Set Ticket.paper in place (keeps the ticket's list order; other fields untouched)."""
        with self._lock:
            cur = self._conn.execute("UPDATE tickets SET data = json_set(data, '$.paper', json(?)) WHERE id = ?",
                                     (_dumps(paper), ticket_id))
            self._conn.commit()
            return cur.rowcount > 0

    # ---------------------------------------------------------------- bridges (WP5)
    def set_ticket_bridge(self, ticket_id: str, state: dict[str, Any]) -> bool:
        """Set Ticket.bridge in place (keeps the ticket's list order; other fields untouched)."""
        with self._lock:
            cur = self._conn.execute("UPDATE tickets SET data = json_set(data, '$.bridge', json(?)) WHERE id = ?",
                                     (_dumps(state), ticket_id))
            self._conn.commit()
            return cur.rowcount > 0

    def list_symbol_map(self) -> list[dict[str, Any]]:
        return [json.loads(r["data"]) for r in self._all("SELECT data FROM bridge_symbol_map ORDER BY seq")]

    def replace_symbol_map(self, rows: list[dict[str, Any]]) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM bridge_symbol_map")
            self._conn.executemany("INSERT INTO bridge_symbol_map (platform, us_symbol, data) VALUES (?,?,?)",
                                   [(r["platform"], r["usSymbol"], _dumps(r)) for r in rows])
            self._conn.commit()
