# Levelset Bridge - MetaTrader 5 Expert Advisor

`LevelsetBridge.mq5` shows Levelset tickets on an MT5 chart. Nothing is sent to the broker until you
click **Place**. See [../README.md](../README.md) for the folder contract and the demo checklist.

## Build and install

1. In MT5: **File > Open Data Folder**, then `MQL5\Experts`. Copy `LevelsetBridge.mq5` there.
2. Open it in **MetaEditor** (F4) and click **Compile**. It must finish with 0 errors.
3. In MT5's Navigator, right-click **Expert Advisors > Refresh**, then drag **LevelsetBridge** onto any chart.
4. Inputs: **InpFolder** = `Levelset` (the folder inside `Common\Files`; keep it unless you changed
   the signals folder in Levelset), **InpMagic** = magic number of orders placed from a panel.
5. Turn on **Algo Trading** in the toolbar (needed for Place to submit the order; without it the
   status in Levelset shows an error).
6. In Levelset > Connections keep the default signals folder
   (`%APPDATA%\MetaQuotes\Terminal\Common\Files\Levelset`) and enable MetaTrader 5.

## Behaviour

- Timer every second: reads `Common\Files\Levelset\mt5\signals\*.json` (`FILE_COMMON`), shows one panel
  at a time with Entry, Stop loss, Take profit, volume (lots), max loss, flat-by; ack `shown`.
- **Place**: re-checks cancel / expiry, rounds the lots **down** to `SYMBOL_VOLUME_STEP`, refuses when
  the price is past the stop or the target, then `CTrade.Buy/Sell` (market) or `BuyLimit/SellLimit`
  with SL/TP; a limit order expires at the flat-by time when the symbol allows it, otherwise GTC.
  Ack `placed`, or `rejected` with the trade server's retcode.
- **Dismiss** / cancel file / expiry: removes the panel (acks `dismissed` / none / `expired`).
- `heartbeat.json` every 5 s: terminal build, demo/live, broker, unknown symbols, Algo Trading state.

## Lots

MT5 volumes are lots. Set **Volume per share** in Levelset's symbol map to `1 / contract size`
(Specification window). Example: contract size 1 -> `1`; contract size 100 -> `0.01`.
