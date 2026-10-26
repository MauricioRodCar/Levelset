"""Platform bridges: signal files for the cBot / EAs, their heartbeats and acks.

Levelset never sends an order. send() only writes a BridgeSignal file per platform;
the cBot / EA shows a panel and the order exists only if the user clicks Place
inside cTrader / MetaTrader. There is no auto-place option, timer or setting.

Volume: qtyShares * volumePerShare, rounded DOWN to volumeStep (risk never grows);
below minVolume the send is refused.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import os
import time
from decimal import ROUND_FLOOR, Decimal
from pathlib import Path
from typing import Any

from ..clock import UTC, iso, ny_local_to_utc, to_ny
from ..context import EngineContext, new_id
from ..pipeline.tickets import window_closes_at, with_live_status
from . import files

log = logging.getLogger("levelset.bridges")

SETTINGS_KEY = "bridges.settings"
STALE_SECONDS = 30.0          # online = heartbeat younger than this (contract)
PRUNE_SECONDS = 3 * 24 * 3600  # old signal / cancel / ack files are removed after 3 days
DEMO_EXPIRY_SECONDS = 30 * 60  # demo tickets are pinned to 2026-10-19: give the panel 30 real minutes
ACK_STATES = {"shown", "placed", "dismissed", "expired", "rejected"}
UNITS = {"ctrader": "units", "mt4": "lots", "mt5": "lots"}


class BridgeError(Exception):
    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status, self.code, self.detail = status, code, detail


def default_folder(ctx: EngineContext) -> Path:
    """Live: the MetaTrader Common Files folder (MT4/MT5 read it with FILE_COMMON; the cBot reads any
    folder). Demo: inside the demo workspace, so the demo never touches a real terminal's folder."""
    if ctx.demo:
        return ctx.config.workspace / "bridges"
    appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(appdata) / "MetaQuotes" / "Terminal" / "Common" / "Files" / "Levelset"


def is_absolute(path: str) -> bool:
    p = str(path or "").strip()
    if not p:
        return False
    if os.name == "nt":
        return Path(p).is_absolute()
    # tests on other OSes: accept POSIX absolute and Windows drive paths
    return p.startswith("/") or (len(p) > 2 and p[1] == ":" and p[2] in "\\/")


def convert_volume(qty: int, row: dict[str, Any]) -> float:
    """qty shares -> platform volume, floored to a multiple of volumeStep (Decimal: no 0.1+0.2 drift)."""
    raw = Decimal(int(qty)) * Decimal(str(row["volumePerShare"]))
    step = Decimal(str(row["volumeStep"]))
    steps = (raw / step).to_integral_value(rounding=ROUND_FLOOR)
    return float(steps * step)


def _unix(moment: dt.datetime) -> int:
    return int(moment.astimezone(UTC).timestamp())


def _wall() -> dt.datetime:
    return dt.datetime.now(UTC).replace(microsecond=0)


class BridgeService:
    def __init__(self, ctx: EngineContext) -> None:
        self.ctx = ctx
        self._ack_seen: dict[str, tuple[float, int]] = {}
        self._last_state: dict[str, str] = {}

    # ---------------------------------------------------------------- settings
    def settings(self) -> dict[str, Any]:
        saved = self.ctx.db.kv_get(SETTINGS_KEY, {}) or {}
        plats = saved.get("platforms") or {}
        return {
            "signalsFolder": saved.get("signalsFolder") or str(default_folder(self.ctx)),
            "platforms": {p: {"enabled": bool((plats.get(p) or {}).get("enabled", False))} for p in files.PLATFORMS},
        }

    def folder(self) -> Path:
        return Path(self.settings()["signalsFolder"])

    def update_settings(self, body: dict[str, Any]) -> dict[str, Any]:
        cur = self.settings()
        if body.get("signalsFolder") is not None:
            folder = str(body["signalsFolder"]).strip()
            if not is_absolute(folder):
                raise BridgeError(422, "validation_error", "signalsFolder must be an absolute path")
            cur["signalsFolder"] = folder
        for p, v in (body.get("platforms") or {}).items():
            if p in files.PLATFORMS and isinstance(v, dict) and "enabled" in v:
                cur["platforms"][p] = {"enabled": bool(v["enabled"])}
        enabled = [p for p in files.PLATFORMS if cur["platforms"][p]["enabled"]]
        if enabled:
            try:
                files.ensure_layout(Path(cur["signalsFolder"]), enabled)
            except OSError as e:
                raise BridgeError(500, "bridge_folder_unwritable", "%s: %s" % (cur["signalsFolder"], e))
        self.ctx.db.kv_set(SETTINGS_KEY, cur)
        return cur

    # ---------------------------------------------------------------- symbol map
    def symbol_map(self) -> dict[str, Any]:
        return {"rows": self.ctx.db.list_symbol_map()}

    def put_symbol_map(self, rows: list[dict[str, Any]]) -> dict[str, Any]:
        clean, seen = [], set()
        for r in rows:
            row = {
                "platform": r["platform"],
                "usSymbol": str(r["usSymbol"]).strip().upper(),
                "brokerSymbol": str(r["brokerSymbol"]).strip(),
                "volumePerShare": float(r["volumePerShare"]),
                "minVolume": float(r["minVolume"]),
                "volumeStep": float(r["volumeStep"]),
            }
            if not row["usSymbol"] or not row["brokerSymbol"]:
                raise BridgeError(422, "validation_error", "usSymbol and brokerSymbol are required")
            for k in ("volumePerShare", "minVolume", "volumeStep"):
                if not row[k] > 0:
                    raise BridgeError(422, "validation_error", "%s must be greater than 0" % k)
            key = (row["platform"], row["usSymbol"])
            if key in seen:
                raise BridgeError(422, "validation_error", "duplicate row for %s %s" % key)
            seen.add(key)
            clean.append(row)
        self.ctx.db.replace_symbol_map(clean)
        return self.symbol_map()

    def _row(self, platform: str, symbol: str) -> dict[str, Any] | None:
        sym = symbol.upper()
        return next((r for r in self.ctx.db.list_symbol_map()
                     if r["platform"] == platform and r["usSymbol"] == sym), None)

    # ---------------------------------------------------------------- status (heartbeat)
    def status(self) -> list[dict[str, Any]]:
        st = self.settings()
        root = Path(st["signalsFolder"])
        now = time.time()  # heartbeats are real files: always the wall clock, also in demo mode
        out = []
        for p in files.PLATFORMS:
            row: dict[str, Any] = {
                "platform": p, "enabled": st["platforms"][p]["enabled"], "state": "not_installed",
                "folder": str(files.platform_dir(root, p)), "lastHeartbeatAt": None, "bridgeVersion": None,
                "platformVersion": None, "accountIsDemo": None, "missingSymbols": [], "error": None,
            }
            hb_path = files.heartbeat_path(root, p)
            if hb_path.is_file():
                hb = files.read_json(hb_path)
                if hb is None or hb.get("schema") != "levelset.heartbeat/1":
                    row.update(state="error", error="heartbeat.json is not a levelset.heartbeat/1 file")
                else:
                    try:
                        t = float(hb.get("timeUnix"))
                    except (TypeError, ValueError):
                        t = hb_path.stat().st_mtime
                    row["lastHeartbeatAt"] = iso(dt.datetime.fromtimestamp(int(t), UTC))
                    row["bridgeVersion"] = str(hb.get("bridgeVersion") or "") or None
                    row["platformVersion"] = str(hb.get("platformVersion") or "") or None
                    if isinstance(hb.get("accountIsDemo"), bool):
                        row["accountIsDemo"] = hb["accountIsDemo"]
                    row["missingSymbols"] = [str(s) for s in (hb.get("missingSymbols") or []) if s]
                    if hb.get("state") == "error":
                        row.update(state="error", error=str(hb.get("error") or "") or "bridge error")
                    else:
                        row["state"] = "online" if now - t < STALE_SECONDS else "offline"
            out.append(row)
        return out

    # ---------------------------------------------------------------- send / cancel
    def _ticket(self, ticket_id: str) -> dict[str, Any]:
        t = self.ctx.db.get_ticket(ticket_id)
        if t is None:
            raise BridgeError(404, "ticket_not_found", ticket_id)
        return with_live_status(t, self.ctx.clock.now())

    def _times(self, ticket: dict[str, Any], wall: dt.datetime) -> tuple[int, int]:
        """(flatByUnix, expiresAtUnix) for today's session."""
        cfg = self.ctx.config_doc()
        flat = str(ticket.get("flatBy") or cfg.get("flat_by") or "15:55")
        if self.ctx.demo:
            day = to_ny(wall).date()
        else:
            try:
                day = dt.date.fromisoformat(str(ticket.get("_date")))
            except ValueError:
                day = to_ny(wall).date()
        try:
            hh, mm = (int(x) for x in flat.split(":"))
            flat_unix = _unix(ny_local_to_utc(dt.datetime.combine(day, dt.time(hh, mm))))
        except ValueError:
            flat_unix = _unix(wall)
        if self.ctx.demo:
            expires = _unix(wall) + DEMO_EXPIRY_SECONDS
        else:
            closes = window_closes_at(ticket)
            if closes is None:
                after = str(cfg.get("no_entries_after") or "15:30")
                hh, mm = (int(x) for x in after.split(":"))
                closes = ny_local_to_utc(dt.datetime.combine(day, dt.time(hh, mm)))
            expires = _unix(closes)
        return flat_unix, expires

    def send(self, ticket_id: str, platforms: list[str] | None = None) -> dict[str, Any]:
        t = self._ticket(ticket_id)
        if t.get("status") != "ready":
            raise BridgeError(409, "ticket_not_ready",
                              "only a ticket that passed the risk check (ready) can be sent; this one is %s"
                              % t.get("status"))
        st = self.settings()
        enabled = [p for p in files.PLATFORMS if st["platforms"][p]["enabled"]]
        targets = [p for p in files.PLATFORMS if p in (platforms or enabled)]
        if not targets or any(p not in enabled for p in targets):
            raise BridgeError(409, "bridge_disabled", "enable the platform in Connections first")
        conv: dict[str, tuple[dict[str, Any], float]] = {}
        for p in targets:
            row = self._row(p, t["symbol"])
            if row is None:
                raise BridgeError(422, "bridge_symbol_unmapped", "%s has no %s symbol in the mapping" % (t["symbol"], p))
            vol = convert_volume(int(t["qty"]), row)
            if vol <= 0 or vol < float(row["minVolume"]) - 1e-12:
                raise BridgeError(422, "bridge_volume_too_small",
                                  "%d shares = %s %s on %s, below the minimum %s"
                                  % (t["qty"], vol, UNITS[p], p, row["minVolume"]))
            conv[p] = (row, vol)

        root = Path(st["signalsFolder"])
        wall = _wall()
        sent_at = iso(self.ctx.clock.now()) or ""
        flat_unix, expires = self._times(t, wall)
        try:
            files.ensure_layout(root, targets)
            old = t.get("bridge")
            if old and not old.get("cancelledAt"):
                self._write_cancels(root, old, "replaced", wall)
            signal_id = new_id("sig")
            plats = []
            for p in targets:
                row, vol = conv[p]
                shares_eff = vol / float(row["volumePerShare"])
                max_loss = round(float(t["maxLoss"]) * min(1.0, shares_eff / max(1, int(t["qty"]))), 2)
                comment = ("Levelset %s %d sh" % (t["symbol"], int(t["qty"])))[:31]
                files.write_atomic(files.signal_path(root, p, signal_id), {
                    "schema": "levelset.signal/1", "signalId": signal_id, "ticketId": t["id"], "platform": p,
                    "usSymbol": t["symbol"], "brokerSymbol": row["brokerSymbol"], "side": t["side"],
                    "orderType": t["orderType"], "entry": float(t["entry"]), "stopLoss": float(t["stop"]),
                    "takeProfit": float(t["target"]), "qtyShares": int(t["qty"]), "volume": vol,
                    "volumeUnit": UNITS[p], "maxLossUsd": max_loss, "flatBy": str(t.get("flatBy") or "15:55"),
                    "flatByUnix": flat_unix, "createdAt": iso(wall), "createdAtUnix": _unix(wall),
                    "expiresAtUnix": expires, "comment": comment,
                })
                plats.append({"platform": p, "brokerSymbol": row["brokerSymbol"], "volume": vol,
                              "volumeUnit": UNITS[p], "state": "written", "updatedAt": sent_at, "error": None})
        except OSError as e:
            raise BridgeError(500, "bridge_folder_unwritable", "%s: %s" % (root, e))
        state = {"ticketId": t["id"], "signalId": signal_id, "sentAt": sent_at, "cancelledAt": None,
                 "platforms": plats}
        self.ctx.db.set_ticket_bridge(t["id"], state)
        return state

    def _write_cancels(self, root: Path, state: dict[str, Any], reason: str, wall: dt.datetime) -> None:
        for pl in state.get("platforms") or []:
            files.write_atomic(files.cancel_path(root, pl["platform"], state["signalId"]), {
                "schema": "levelset.cancel/1", "signalId": state["signalId"], "ticketId": state["ticketId"],
                "reason": reason, "createdAtUnix": _unix(wall)})

    def cancel(self, ticket_id: str) -> dict[str, Any]:
        t = self.ctx.db.get_ticket(ticket_id)
        if t is None:
            raise BridgeError(404, "ticket_not_found", ticket_id)
        state = t.get("bridge")
        if not state:
            raise BridgeError(404, "bridge_not_sent", "this ticket was never sent to a platform")
        if state.get("cancelledAt"):
            return state
        try:
            self._write_cancels(self.folder(), state, "user", _wall())
        except OSError as e:
            raise BridgeError(500, "bridge_folder_unwritable", str(e))
        now = iso(self.ctx.clock.now()) or ""
        state["cancelledAt"] = now
        for pl in state["platforms"]:
            if pl["state"] != "placed":  # an order the user placed stays placed: Levelset cannot undo it
                pl.update(state="cancelled", updatedAt=now)
        self.ctx.db.set_ticket_bridge(ticket_id, state)
        return state

    # ---------------------------------------------------------------- acks + status changes
    def collect(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Read new ack files into Ticket.bridge and compare each platform's status with the last poll.
        Thread-safe (no event publishing). Returns (updated BridgeTicketStates, changed BridgeStatus rows)."""
        root = self.folder()
        updated: dict[str, dict[str, Any]] = {}
        for p in files.PLATFORMS:
            for path in files.ack_files(root, p):
                try:
                    stat = path.stat()
                except OSError:
                    continue
                key = str(path)
                sig = (stat.st_mtime, stat.st_size)
                if self._ack_seen.get(key) == sig:
                    continue
                ack = files.read_json(path)
                if ack is None:
                    continue  # half written: try again next time
                self._ack_seen[key] = sig
                state = self._apply_ack(p, ack, updated)
                if state is not None:
                    updated[state["ticketId"]] = state
            files.prune(root, p, PRUNE_SECONDS)
        for state in updated.values():
            self.ctx.db.set_ticket_bridge(state["ticketId"], state)
        changed = []
        for row in self.status():
            prev = self._last_state.get(row["platform"])
            if prev is not None and prev != row["state"]:
                changed.append(row)
            self._last_state[row["platform"]] = row["state"]
        return list(updated.values()), changed

    def publish(self, updated: list[dict[str, Any]], changed: list[dict[str, Any]]) -> None:
        """Call from the event loop thread: bridge.updated / bridge.status SSE events."""
        for state in updated:
            self.ctx.bus.publish("bridge.updated", state)
        for row in changed:
            self.ctx.bus.publish("bridge.status", row)

    def poll(self) -> list[dict[str, Any]]:
        """One poll from the event loop thread (tests, routes). Returns the updated BridgeTicketStates."""
        updated, changed = self.collect()
        self.publish(updated, changed)
        return updated

    def _apply_ack(self, platform: str, ack: dict[str, Any], pending: dict[str, dict[str, Any]]
                   ) -> dict[str, Any] | None:
        if ack.get("schema") != "levelset.ack/1" or ack.get("state") not in ACK_STATES:
            return None
        tid = str(ack.get("ticketId") or "")
        state = pending.get(tid)
        if state is None:
            t = self.ctx.db.get_ticket(tid)
            state = (t or {}).get("bridge")
        if not state or state.get("signalId") != ack.get("signalId"):
            return None  # an ack for a replaced or unknown signal
        pl = next((x for x in state["platforms"] if x["platform"] == platform), None)
        if pl is None:
            return None
        new = ack["state"]
        if pl["state"] == "placed" or (pl["state"] == "cancelled" and new not in ("placed", "rejected")):
            return None  # placed is final; after a cancel only a Place that already happened counts
        try:
            when = iso(dt.datetime.fromtimestamp(int(ack.get("timeUnix")), UTC))
        except (TypeError, ValueError, OSError):
            when = iso(_wall())
        err = str(ack.get("error") or "") or None
        if pl["state"] == new and pl.get("error") == err:
            return None
        pl.update(state=new, updatedAt=when, error=err if new == "rejected" else None)
        return state

    async def loop(self, interval: float = 2.0) -> None:
        """Background: poll acks and heartbeats every `interval` seconds."""
        while True:
            try:
                updated, changed = await asyncio.to_thread(self.collect)
                self.publish(updated, changed)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - keep the loop alive
                log.exception("bridge poll failed")
            await asyncio.sleep(interval)
