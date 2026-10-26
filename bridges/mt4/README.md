# Levelset Bridge - MetaTrader 4 Expert Advisor

`LevelsetBridge.mq4` shows Levelset tickets on an MT4 chart. Nothing is sent to the broker until you
click **Place**. See [../README.md](../README.md) for the folder contract and the demo checklist.

## Build and install

1. In MT4: **File > Open Data Folder**, then `MQL4\Experts`. Copy `LevelsetBridge.mq4` there.
2. Open it in **MetaEditor** (F4) and click **Compile** (needs MT4 build 1090 or newer). 0 errors.
3. Navigator > **Expert Advisors > Refresh**, then drag **LevelsetBridge** onto any chart.
4. Inputs: **InpFolder** = `Levelset` (inside `Common\Files`), **InpMagic**, **InpSlippage**
   (points, market orders).
5. Turn on **AutoTrading** in the toolbar and allow live trading in the EA's Common tab.
6. In Levelset > Connections keep the default signals folder and enable MetaTrader 4.

## Behaviour

Same as the MT5 EA (one panel at a time, acks, heartbeat) with these MT4 differences:

- Orders use `OrderSend` (market at Ask/Bid with `InpSlippage`, or `OP_BUYLIMIT/OP_SELLLIMIT` at the entry).
- Accounts with market execution that refuse SL/TP on the order (error 130): the EA opens the
  position and sets SL/TP immediately with `OrderModify`; if that fails it shows an **Alert** with the
  levels so you set them yourself.
- Pending orders have no expiry: delete them yourself by the flat-by time.
- Lots are rounded down to `MODE_LOTSTEP`; below `MODE_MINLOT` the signal is rejected.
