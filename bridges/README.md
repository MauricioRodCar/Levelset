# Levelset platform bridges

Source for the in-platform bridges (MIT, same licence as the repo). You build them yourself in the
platform's editor; Levelset does not ship compiled bots.

| Platform | File | Build in |
| --- | --- | --- |
| cTrader | [`ctrader/LevelsetBridge.cs`](ctrader/README.md) | cTrader Automate (cBot) |
| MetaTrader 5 | [`mt5/LevelsetBridge.mq5`](mt5/README.md) | MetaEditor 5 (Expert Advisor) |
| MetaTrader 4 | [`mt4/LevelsetBridge.mq4`](mt4/README.md) | MetaEditor 4 (Expert Advisor) |

## Levelset never sends orders

1. In Levelset you click **Send to platform** on a ticket that passed the risk check (PASS).
2. The engine only **writes a signal file** in the signals folder. It has no broker connection.
3. The bridge in your platform **shows a panel**: Entry, Stop loss, Take profit, volume, max loss,
   with **Place** and **Dismiss**.
4. An order exists only if **you click Place** inside cTrader / MetaTrader. There is no auto-place
   option, no timer that places, and no "always place" setting in Levelset or in the bridges.

Dismiss, **Cancel in platform** in Levelset (a cancel file), or the end of the entry window
(`expiresAtUnix`) only remove the panel. A cancel can never undo an order you already placed.

## Folder layout (the contract: `docs/api/openapi.yaml`, BridgeSettings)

```
<signalsFolder>\<platform>\signals\<signalId>.json   BridgeSignal     written by Levelset
<signalsFolder>\<platform>\cancel\<signalId>.json    BridgeCancel     written by Levelset
<signalsFolder>\<platform>\acks\<signalId>.json      BridgeAck        written by the bridge
<signalsFolder>\<platform>\heartbeat.json            BridgeHeartbeat  written by the bridge every 5 s
```

- Default `signalsFolder`: `%APPDATA%\MetaQuotes\Terminal\Common\Files\Levelset` - the terminals'
  shared **Common Files** folder, which MT4/MT5 EAs can read with `FILE_COMMON`. The cBot reads any
  folder (it needs Full Access). Keep the default if you use MetaTrader; change it in
  Levelset > Connections only for cTrader. In demo mode the default is `<demo workspace>\bridges`.
- Files are flat one-line JSON, UTF-8 without BOM, written to `<name>.tmp` and renamed. Times are
  Unix seconds (UTC). Levelset removes signal / cancel / ack files older than 3 days.
- Status in Levelset: **online** = heartbeat younger than 30 s, **offline** = older,
  **not installed** = no heartbeat file yet, **error** = the bridge reported a problem
  (for example Algo Trading switched off).

## Symbol map and volume

US tickers rarely match the broker's CFD names, so each platform has its own rows in
Levelset > Connections > Symbol mapping:

| Field | cTrader | MT4 / MT5 |
| --- | --- | --- |
| Broker symbol | e.g. `TSLA.US` (Pepperstone) | e.g. `TSLA.US` / `#TSLA` |
| Volume per share | units per share, usually `1` | lots per share = 1 / contract size (contract 1 -> `1`, contract 100 -> `0.01`) |
| Min volume / step | from the symbol's info | `Specification` window: minimal volume / volume step |

`volume = shares x volumePerShare`, **rounded down** to the step so the risk never grows. Below the
minimum the send is refused (`bridge_volume_too_small`). Each bridge rounds down again with the
broker's own step before placing.

## Pepperstone demo test checklist

Success criterion (v1.1 PRD §10.4): a ticket reaches a **cTrader demo account** through the cBot with
the **correct SL/TP after symbol mapping**, and is **placed only after you click Place**.

1. Open a Pepperstone **demo** account in cTrader (and MT4/MT5 if you test those).
2. Build and start the bridge (see each README). In Levelset > Connections, enable the platform and
   check the status turns **online** within 10 s, with **Demo account**.
3. Add a symbol row: `TSLA` -> `TSLA.US` (check the exact name in the platform's symbol search),
   volume per share / min / step from the symbol's specification.
4. During US market hours, run the pipeline until a ticket shows **PASS**. Click
   **Send to platform**. The panel appears in the platform within 2 s; the ticket shows **Shown**.
5. Wait 30 s without clicking: **no order or position appears** (nothing is placed on its own).
6. Click **Dismiss**: the panel disappears, the ticket shows **Dismissed**, still no order.
7. Send again, then click **Cancel in platform** in Levelset: the panel disappears.
8. Send again and click **Place**. Check in Positions / Trade: symbol, volume, side, and that
   **Stop loss and Take profit equal the ticket's levels**. The ticket shows **Placed**.
9. Unmapped symbol: send a ticket whose ticker has no row -> Levelset refuses with
   "no symbol mapping"; nothing is written.
10. Stop the bot: within 30 s the status turns **offline**.
11. Close the demo position yourself.

## Known limits

- Built and reviewed without the platforms at hand: the cBot was syntax-checked against stubs of
  the cAlgo API, the EAs were not compiled. Expect small fixes on the first build in your version of
  cTrader / MetaEditor (the editor's IntelliSense shows the exact names).
- Long and short tickets are shown as they come; Levelset's skills only produce long (buy) tickets today.
- cTrader market orders: SL/TP are sent as pips from the current price, then moved to the ticket's
  exact prices right after the fill.
- MT4 pending (limit) orders carry no expiry; delete them yourself by the flat-by time.
  MT4 market-execution accounts that refuse stops on the order: the bridge opens the position and
  adds SL/TP at once; if that fails it raises an alert so you set them by hand.
- MetaTrader EAs show one panel at a time (the next signal appears after you answer the first);
  the cBot stacks panels.
- The bridges never close a position at the flat-by time. Close it yourself.
