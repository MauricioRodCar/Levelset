# Levelset Bridge - cTrader cBot

`LevelsetBridge.cs` shows Levelset tickets on a cTrader chart. Nothing is sent to the broker until
you click **Place** on the panel. See [../README.md](../README.md) for the folder contract and the
Pepperstone demo checklist.

## Build and install

1. cTrader > **Automate** > **cBots** > **New** (C#). Name it `LevelsetBridge`.
2. Replace the template with the whole content of `LevelsetBridge.cs` and click **Build**.
3. Add an instance to any chart (the symbol of the chart does not matter).
4. Parameters:
   - **Signals folder** - leave empty for the default
     `%APPDATA%\MetaQuotes\Terminal\Common\Files\Levelset` (the cBot adds `\ctrader`), or paste the
     folder shown in Levelset > Connections.
   - **Order label** - label of the orders you place from a panel (default `Levelset`).
5. Start it. When cTrader asks for **Access Rights**, allow **Full Access** (the cBot reads and writes
   files in the signals folder; it makes no internet calls).
6. In Levelset > Connections, enable cTrader: the status turns **online** within 10 seconds.

## What it does

- Every second: reads `signals\*.json`, shows a panel per signal (Entry, Stop loss, Take profit,
  volume, max loss, flat-by time), and writes an ack `shown`.
- **Place**: checks the cancel file and the expiry again, rounds the volume **down** to the symbol's
  step, refuses when the price is already past the stop or the target, then submits a market order
  (or a limit order at the entry) with stop loss and take profit. Ack `placed` or `rejected` with the
  platform's message.
- **Dismiss**: removes the panel, ack `dismissed`. Cancel file from Levelset: removes the panel.
  Expired signal: removes the panel, ack `expired`.
- Every 5 seconds: `heartbeat.json` with the bridge version, demo/live, broker name, panels shown
  and broker symbols the account does not know.

## Notes

- Uses the cAlgo API members `Robot`, `Timer`, `Chart.AddControl`, `StackPanel`, `Border`,
  `TextBlock`, `Button`, `Symbols.Exists/GetSymbol`, `ExecuteMarketOrder`, `PlaceLimitOrder`,
  `Position.ModifyStopLossPrice/ModifyTakeProfitPrice`, `Account.IsLive`, `Account.BrokerName`.
  If your cTrader version names something differently, IntelliSense in Automate shows the right name.
- `platformVersion` is left empty in the heartbeat.
