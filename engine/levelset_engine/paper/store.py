"""SQLite rows for the paper account (tables paper_accounts, paper_positions, paper_fills, paper_events).

A paper_positions row is one ticket the account handled, through its whole life:
pending (waiting for the next bar's open) -> open -> closed, or skipped. The trade log is the
closed + skipped rows; open positions are the open rows. Everything else is in its JSON `data`.
"""

from __future__ import annotations

import json
from typing import Any

from ..storage.db import Database, _dumps


class PaperStore:
    def __init__(self, db: Database) -> None:
        self.db = db

    # ---------------------------------------------------------------- accounts
    def accounts(self) -> list[dict[str, Any]]:
        return [json.loads(r["data"]) for r in self.db._all("SELECT data FROM paper_accounts ORDER BY seq")]

    def account(self, account_id: str) -> dict[str, Any] | None:
        rows = self.db._all("SELECT data FROM paper_accounts WHERE id = ?", (account_id,))
        return json.loads(rows[0]["data"]) if rows else None

    def put_account(self, a: dict[str, Any]) -> None:
        with self.db._lock:
            cur = self.db._conn.execute("UPDATE paper_accounts SET data = ? WHERE id = ?", (_dumps(a), a["id"]))
            if cur.rowcount == 0:
                self.db._conn.execute("INSERT INTO paper_accounts (id, created_at, data) VALUES (?,?,?)",
                                      (a["id"], a["createdAt"], _dumps(a)))
            self.db._conn.commit()

    # ---------------------------------------------------------------- positions / trade log
    def put_position(self, p: dict[str, Any]) -> None:
        with self.db._lock:
            cur = self.db._conn.execute("UPDATE paper_positions SET status = ?, data = ? WHERE id = ?",
                                        (p["status"], _dumps(p), p["id"]))
            if cur.rowcount == 0:
                self.db._conn.execute(
                    "INSERT INTO paper_positions (id, account_id, period_id, ticket_id, symbol, status, created_at, "
                    "data) VALUES (?,?,?,?,?,?,?,?)",
                    (p["id"], p["accountId"], p["periodId"], p["ticketId"], p["symbol"], p["status"], p["createdAt"],
                     _dumps(p)))
            self.db._conn.commit()

    def position(self, position_id: str) -> dict[str, Any] | None:
        rows = self.db._all("SELECT data FROM paper_positions WHERE id = ?", (position_id,))
        return json.loads(rows[0]["data"]) if rows else None

    def positions(self, account_id: str | None = None, statuses: tuple[str, ...] | None = None,
                  period_id: str | None = None, newest_first: bool = False) -> list[dict[str, Any]]:
        sql, args = "SELECT data FROM paper_positions WHERE 1=1", []
        if account_id:
            sql += " AND account_id = ?"
            args.append(account_id)
        if period_id and period_id != "all":
            sql += " AND period_id = ?"
            args.append(period_id)
        if statuses:
            sql += " AND status IN (%s)" % ",".join("?" * len(statuses))
            args += list(statuses)
        sql += " ORDER BY created_at %s, seq %s" % (("DESC",) * 2 if newest_first else ("ASC",) * 2)
        return [json.loads(r["data"]) for r in self.db._all(sql, tuple(args))]

    # ---------------------------------------------------------------- fills and events
    def add_fill(self, f: dict[str, Any]) -> None:
        self.db._exec("INSERT OR REPLACE INTO paper_fills (id, position_id, account_id, created_at, data) "
                      "VALUES (?,?,?,?,?)", (f["id"], f["positionId"], f["accountId"], f["at"], _dumps(f)))

    def fills(self, position_id: str) -> list[dict[str, Any]]:
        rows = self.db._all("SELECT data FROM paper_fills WHERE position_id = ? ORDER BY seq", (position_id,))
        return [json.loads(r["data"]) for r in rows]

    def add_event(self, account_id: str | None, kind: str, at: str, data: dict[str, Any]) -> None:
        self.db._exec("INSERT INTO paper_events (account_id, type, created_at, data) VALUES (?,?,?,?)",
                      (account_id, kind, at, _dumps(data)))

    def events(self, account_id: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT account_id, type, created_at, data FROM paper_events"
        rows = self.db._all(sql + (" WHERE account_id = ?" if account_id else "") + " ORDER BY seq",
                            (account_id,) if account_id else ())
        return [{"accountId": r["account_id"], "type": r["type"], "at": r["created_at"],
                 "data": json.loads(r["data"])} for r in rows]
