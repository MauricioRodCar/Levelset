// Levelset Bridge for cTrader (cBot, cTrader Automate / cAlgo API).
// MIT License - part of Levelset (github.com/MauricioRodCar/Levelset). See bridges/README.md.
//
// What it does
//   - Every second it looks for signal files that Levelset wrote in <folder>\signals\*.json.
//   - It shows each signal on the chart as a panel: Entry, Stop loss, Take profit (in that order),
//     volume and max loss, with two buttons: Place and Dismiss.
//   - NOTHING is sent to the broker unless YOU click Place. There is no auto-place option, no timer
//     that places, and no "always place" setting. Dismiss, a cancel file from Levelset or the
//     signal's expiry time only remove the panel.
//   - It writes an ack file per signal (shown / placed / dismissed / expired / rejected) and a
//     heartbeat.json every 5 seconds so Levelset can show the bridge as online.
//
// Install: cTrader > Automate > New cBot > paste this file > Build. Add it to any chart and set
// Access Rights to Full Access when cTrader asks (needed to read the signals folder).

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(TimeZone = TimeZones.UTC, AccessRights = AccessRights.FullAccess)]
    public class LevelsetBridge : Robot
    {
        private const string BridgeVersion = "1.1.0";
        private const string Platform = "ctrader";

        [Parameter("Signals folder (empty = default)", DefaultValue = "", Group = "Levelset")]
        public string FolderParameter { get; set; }

        [Parameter("Order label", DefaultValue = "Levelset", Group = "Levelset")]
        public string OrderLabel { get; set; }

        private string _folder;
        private readonly Dictionary<string, SignalView> _views = new Dictionary<string, SignalView>();
        private readonly HashSet<string> _done = new HashSet<string>();
        private readonly HashSet<string> _missingSymbols = new HashSet<string>();
        private StackPanel _stack;
        private DateTime _lastHeartbeat = DateTime.MinValue;
        private string _lastError = "";

        protected override void OnStart()
        {
            _folder = ResolveFolder();
            Directory.CreateDirectory(Path.Combine(_folder, "signals"));
            Directory.CreateDirectory(Path.Combine(_folder, "cancel"));
            Directory.CreateDirectory(Path.Combine(_folder, "acks"));
            Print("Levelset Bridge {0} watching {1}", BridgeVersion, _folder);

            _stack = new StackPanel
            {
                Orientation = Orientation.Vertical,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(10),
            };
            Chart.AddControl(_stack);

            Timer.Start(TimeSpan.FromSeconds(1));
            Scan();
            WriteHeartbeat();
        }

        protected override void OnTimer()
        {
            try
            {
                Scan();
                _lastError = "";
            }
            catch (Exception ex)
            {
                _lastError = ex.Message;
                Print("Levelset Bridge: " + ex.Message);
            }
            if ((DateTime.UtcNow - _lastHeartbeat).TotalSeconds >= 5)
                WriteHeartbeat();
        }

        protected override void OnStop()
        {
            if (_stack != null)
                Chart.RemoveControl(_stack);
        }

        // ------------------------------------------------------------ folder
        private string ResolveFolder()
        {
            string root = string.IsNullOrWhiteSpace(FolderParameter)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                               "MetaQuotes", "Terminal", "Common", "Files", "Levelset")
                : FolderParameter.Trim();
            // Accept both <signalsFolder> and <signalsFolder>\ctrader.
            return string.Equals(Path.GetFileName(root.TrimEnd('\\', '/')), Platform, StringComparison.OrdinalIgnoreCase)
                ? root
                : Path.Combine(root, Platform);
        }

        // ------------------------------------------------------------ scan signals / cancels / expiry
        private void Scan()
        {
            long now = NowUnix();
            string signalsDir = Path.Combine(_folder, "signals");
            foreach (string file in Directory.GetFiles(signalsDir, "*.json"))
            {
                string id = Path.GetFileNameWithoutExtension(file);
                if (_done.Contains(id) || _views.ContainsKey(id))
                    continue;
                Dictionary<string, string> sig = MiniJson.TryParseFile(file);
                if (sig == null)
                    continue; // being written: next second
                if (Get(sig, "schema") != "levelset.signal/1" || Get(sig, "platform") != Platform)
                {
                    _done.Add(id);
                    continue;
                }
                if (File.Exists(CancelPath(id)) || IsFinal(id))
                {
                    _done.Add(id);
                    continue;
                }
                if (GetLong(sig, "expiresAtUnix") <= now)
                {
                    _done.Add(id);
                    WriteAck(sig, "expired", "");
                    continue;
                }
                Show(id, sig);
            }

            foreach (SignalView view in _views.Values.ToList())
            {
                if (File.Exists(CancelPath(view.Id)))
                    Remove(view, null, "");
                else if (GetLong(view.Signal, "expiresAtUnix") <= now)
                    Remove(view, "expired", "");
            }
        }

        private bool IsFinal(string id)
        {
            string ack = Path.Combine(_folder, "acks", id + ".json");
            Dictionary<string, string> doc = File.Exists(ack) ? MiniJson.TryParseFile(ack) : null;
            string state = doc == null ? "" : Get(doc, "state");
            return state == "placed" || state == "dismissed" || state == "expired" || state == "rejected";
        }

        private string CancelPath(string id)
        {
            return Path.Combine(_folder, "cancel", id + ".json");
        }

        // ------------------------------------------------------------ the panel
        private void Show(string id, Dictionary<string, string> sig)
        {
            string brokerSymbol = Get(sig, "brokerSymbol");
            bool known = Symbols.Exists(brokerSymbol);
            if (!known)
                _missingSymbols.Add(brokerSymbol);

            var view = new SignalView { Id = id, Signal = sig };
            bool buy = Get(sig, "side") != "sell";
            var panel = new StackPanel { Orientation = Orientation.Vertical };

            panel.AddChild(Text(string.Format("Levelset  {0} {1} {2}", buy ? "BUY" : "SELL",
                Get(sig, "qtyShares"), Get(sig, "usSymbol")), 14, true));
            panel.AddChild(Text(string.Format("{0} order on {1}", Get(sig, "orderType") == "limit" ? "Limit" : "Market",
                brokerSymbol), 11, false));
            // Ticket levels: Entry -> Stop loss -> Take profit, largest text, neutral colour.
            panel.AddChild(Level("Entry", GetNum(sig, "entry")));
            panel.AddChild(Level("Stop loss", GetNum(sig, "stopLoss")));
            panel.AddChild(Level("Take profit", GetNum(sig, "takeProfit")));
            panel.AddChild(Text(string.Format("Volume {0} {1}   Max loss ${2}", Get(sig, "volume"), Get(sig, "volumeUnit"),
                Get(sig, "maxLossUsd")), 11, false));
            panel.AddChild(Text("Flat by " + Get(sig, "flatBy") + " ET", 11, false));

            view.Status = Text(known ? "Nothing is sent until you click Place." : "Symbol " + brokerSymbol +
                " not found: fix the symbol map in Levelset.", 11, false);
            panel.AddChild(view.Status);

            var buttons = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 8, 0, 0) };
            view.Place = new Button
            {
                Text = "Place",
                IsEnabled = known,
                Margin = new Thickness(0, 0, 8, 0),
                Padding = new Thickness(14, 4, 14, 4),
                BackgroundColor = Color.FromHex("#FF1F6FEB"),
                ForegroundColor = Color.White,
            };
            view.Dismiss = new Button
            {
                Text = "Dismiss",
                Padding = new Thickness(14, 4, 14, 4),
                BackgroundColor = Color.FromHex("#FF3A4656"),
                ForegroundColor = Color.White,
            };
            view.Place.Click += args => OnPlace(view);
            view.Dismiss.Click += args => Remove(view, "dismissed", "");
            buttons.AddChild(view.Place);
            buttons.AddChild(view.Dismiss);
            panel.AddChild(buttons);

            view.Root = new Border
            {
                BackgroundColor = Color.FromHex("#F0121A24"),
                BorderColor = Color.FromHex("#FF3A4A5E"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(12),
                Margin = new Thickness(0, 0, 0, 8),
                Width = 280,
                Child = panel,
            };
            _stack.AddChild(view.Root);
            _views[id] = view;
            WriteAck(sig, "shown", "");
        }

        private static TextBlock Text(string text, int size, bool bold)
        {
            return new TextBlock
            {
                Text = text,
                FontSize = size,
                FontWeight = bold ? FontWeight.Bold : FontWeight.Normal,
                ForegroundColor = Color.FromHex("#FFE6EDF3"),
                Margin = new Thickness(0, 2, 0, 2),
            };
        }

        private static StackPanel Level(string label, double value)
        {
            var row = new StackPanel { Orientation = Orientation.Vertical, Margin = new Thickness(0, 4, 0, 0) };
            row.AddChild(new TextBlock { Text = label, FontSize = 11, ForegroundColor = Color.FromHex("#FF9AA7B5") });
            row.AddChild(new TextBlock
            {
                Text = value.ToString("0.00###", CultureInfo.InvariantCulture),
                FontSize = 20,
                ForegroundColor = Color.FromHex("#FFE6EDF3"),
            });
            return row;
        }

        private void Remove(SignalView view, string ackState, string error)
        {
            if (!_views.Remove(view.Id))
                return;
            _done.Add(view.Id);
            _stack.RemoveChild(view.Root);
            if (ackState != null)
                WriteAck(view.Signal, ackState, error);
        }

        // ------------------------------------------------------------ Place = the user's explicit click
        private void OnPlace(SignalView view)
        {
            if (!_views.ContainsKey(view.Id))
                return;
            view.Place.IsEnabled = false;
            view.Dismiss.IsEnabled = false;
            Dictionary<string, string> sig = view.Signal;

            // Last checks at click time: withdrawn or expired signals are never placed.
            if (File.Exists(CancelPath(view.Id)))
            {
                Remove(view, null, "");
                return;
            }
            if (GetLong(sig, "expiresAtUnix") <= NowUnix())
            {
                Remove(view, "expired", "");
                return;
            }

            string name = Get(sig, "brokerSymbol");
            if (!Symbols.Exists(name))
            {
                Reject(view, "symbol " + name + " not found at this broker");
                return;
            }
            Symbol symbol = Symbols.GetSymbol(name);
            TradeType side = Get(sig, "side") == "sell" ? TradeType.Sell : TradeType.Buy;
            double entry = GetNum(sig, "entry");
            double stop = GetNum(sig, "stopLoss");
            double target = GetNum(sig, "takeProfit");

            // Never round the volume up: risk must not grow.
            double volume = symbol.NormalizeVolumeInUnits(GetNum(sig, "volume"), RoundingMode.Down);
            if (volume < symbol.VolumeInUnitsMin)
            {
                Reject(view, string.Format(CultureInfo.InvariantCulture, "volume {0} is below this symbol's minimum {1}",
                    GetNum(sig, "volume"), symbol.VolumeInUnitsMin));
                return;
            }

            string comment = Get(sig, "comment");
            bool limit = Get(sig, "orderType") == "limit";
            TradeResult result;
            if (limit)
            {
                double slPips = Math.Abs(entry - stop) / symbol.PipSize;
                double tpPips = Math.Abs(target - entry) / symbol.PipSize;
                DateTime expiry = DateTimeOffset.FromUnixTimeSeconds(GetLong(sig, "flatByUnix")).UtcDateTime;
                result = PlaceLimitOrder(side, name, volume, entry, OrderLabel, slPips, tpPips,
                    expiry > DateTime.UtcNow ? (DateTime?)expiry : null, comment);
            }
            else
            {
                double price = side == TradeType.Buy ? symbol.Ask : symbol.Bid;
                bool sane = side == TradeType.Buy ? (symbol.Bid > stop && symbol.Ask < target)
                                                  : (symbol.Ask < stop && symbol.Bid > target);
                if (!sane)
                {
                    Reject(view, string.Format(CultureInfo.InvariantCulture,
                        "price {0} is already past the stop loss or the take profit", price));
                    return;
                }
                double slPips = Math.Abs(price - stop) / symbol.PipSize;
                double tpPips = Math.Abs(target - price) / symbol.PipSize;
                result = ExecuteMarketOrder(side, name, volume, OrderLabel, slPips, tpPips, comment);
                if (result.IsSuccessful && result.Position != null)
                {
                    // The pips above protect the position at once; now pin the exact ticket levels.
                    result.Position.ModifyStopLossPrice(stop);
                    result.Position.ModifyTakeProfitPrice(target);
                }
            }

            if (result.IsSuccessful)
            {
                Print("Levelset: placed {0} {1} {2} SL {3} TP {4} (clicked Place)", side, volume, name, stop, target);
                Remove(view, "placed", "");
            }
            else
            {
                Reject(view, result.Error.HasValue ? result.Error.Value.ToString() : "order rejected");
            }
        }

        private void Reject(SignalView view, string message)
        {
            Print("Levelset: not placed: " + message);
            Remove(view, "rejected", message);
        }

        // ------------------------------------------------------------ files Levelset reads
        private void WriteAck(Dictionary<string, string> sig, string state, string error)
        {
            var sb = new StringBuilder();
            sb.Append("{\"schema\":\"levelset.ack/1\"");
            sb.Append(",\"signalId\":").Append(MiniJson.Quote(Get(sig, "signalId")));
            sb.Append(",\"ticketId\":").Append(MiniJson.Quote(Get(sig, "ticketId")));
            sb.Append(",\"platform\":\"").Append(Platform).Append('"');
            sb.Append(",\"state\":\"").Append(state).Append('"');
            sb.Append(",\"timeUnix\":").Append(NowUnix().ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"error\":").Append(MiniJson.Quote(error ?? ""));
            sb.Append('}');
            WriteAtomic(Path.Combine(_folder, "acks", Get(sig, "signalId") + ".json"), sb.ToString());
        }

        private void WriteHeartbeat()
        {
            _lastHeartbeat = DateTime.UtcNow;
            var sb = new StringBuilder();
            sb.Append("{\"schema\":\"levelset.heartbeat/1\"");
            sb.Append(",\"platform\":\"").Append(Platform).Append('"');
            sb.Append(",\"bridgeVersion\":\"").Append(BridgeVersion).Append('"');
            sb.Append(",\"platformVersion\":\"\"");
            sb.Append(",\"state\":\"").Append(string.IsNullOrEmpty(_lastError) ? "running" : "error").Append('"');
            sb.Append(",\"accountIsDemo\":").Append(Account.IsLive ? "false" : "true");
            sb.Append(",\"broker\":").Append(MiniJson.Quote(Account.BrokerName ?? ""));
            sb.Append(",\"timeUnix\":").Append(NowUnix().ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"pendingSignals\":").Append(_views.Count.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"missingSymbols\":[").Append(string.Join(",", _missingSymbols.Select(MiniJson.Quote))).Append(']');
            sb.Append(",\"error\":").Append(MiniJson.Quote(_lastError));
            sb.Append('}');
            try
            {
                WriteAtomic(Path.Combine(_folder, "heartbeat.json"), sb.ToString());
            }
            catch (Exception ex)
            {
                Print("Levelset Bridge: heartbeat not written: " + ex.Message);
            }
        }

        private static void WriteAtomic(string path, string json)
        {
            string tmp = path + ".tmp";
            File.WriteAllBytes(tmp, new UTF8Encoding(false).GetBytes(json));
            if (File.Exists(path))
                File.Replace(tmp, path, null);
            else
                File.Move(tmp, path);
        }

        // ------------------------------------------------------------ helpers
        private static long NowUnix()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        }

        private static string Get(Dictionary<string, string> d, string key)
        {
            string v;
            return d.TryGetValue(key, out v) ? v : "";
        }

        private static double GetNum(Dictionary<string, string> d, string key)
        {
            double v;
            return double.TryParse(Get(d, key), NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0;
        }

        private static long GetLong(Dictionary<string, string> d, string key)
        {
            return (long)GetNum(d, key);
        }

        private class SignalView
        {
            public string Id;
            public Dictionary<string, string> Signal;
            public Border Root;
            public Button Place;
            public Button Dismiss;
            public TextBlock Status;
        }
    }

    /// <summary>Reads Levelset's flat JSON files (string, number, boolean values; arrays kept raw).</summary>
    public static class MiniJson
    {
        public static Dictionary<string, string> TryParseFile(string path)
        {
            try
            {
                string text = File.ReadAllText(path, Encoding.UTF8);
                return Parse(text);
            }
            catch (IOException)
            {
                return null;
            }
            catch (FormatException)
            {
                return null;
            }
        }

        public static Dictionary<string, string> Parse(string s)
        {
            var d = new Dictionary<string, string>();
            int i = 0;
            Skip(s, ref i);
            if (i >= s.Length || s[i] != '{')
                throw new FormatException("not an object");
            i++;
            while (true)
            {
                Skip(s, ref i);
                if (i < s.Length && s[i] == '}')
                    return d;
                string key = ReadString(s, ref i);
                Skip(s, ref i);
                if (i >= s.Length || s[i] != ':')
                    throw new FormatException("':' expected");
                i++;
                Skip(s, ref i);
                d[key] = ReadValue(s, ref i);
                Skip(s, ref i);
                if (i < s.Length && s[i] == ',')
                {
                    i++;
                    continue;
                }
                if (i < s.Length && s[i] == '}')
                    return d;
                throw new FormatException("',' or '}' expected");
            }
        }

        private static void Skip(string s, ref int i)
        {
            while (i < s.Length && (char.IsWhiteSpace(s[i]) || s[i] == '﻿'))
                i++;
        }

        private static string ReadValue(string s, ref int i)
        {
            if (i >= s.Length)
                throw new FormatException("value expected");
            if (s[i] == '"')
                return ReadString(s, ref i);
            int start = i;
            int depth = 0;
            while (i < s.Length)
            {
                char c = s[i];
                if (c == '[' || c == '{')
                    depth++;
                else if (c == ']' || c == '}')
                {
                    if (depth == 0)
                        break;
                    depth--;
                }
                else if (c == ',' && depth == 0)
                    break;
                i++;
            }
            if (depth != 0)
                throw new FormatException("unterminated value");
            return s.Substring(start, i - start).Trim();
        }

        private static string ReadString(string s, ref int i)
        {
            if (i >= s.Length || s[i] != '"')
                throw new FormatException("string expected");
            i++;
            var sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"')
                    return sb.ToString();
                if (c != '\\')
                {
                    sb.Append(c);
                    continue;
                }
                if (i >= s.Length)
                    break;
                char e = s[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 't': sb.Append('\t'); break;
                    case 'r': sb.Append('\r'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u':
                        if (i + 4 > s.Length)
                            throw new FormatException("bad escape");
                        sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default: sb.Append(e); break;
                }
            }
            throw new FormatException("unterminated string");
        }

        public static string Quote(string v)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in v ?? "")
            {
                if (c == '"' || c == '\\')
                    sb.Append('\\').Append(c);
                else if (c < ' ')
                    sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                else
                    sb.Append(c);
            }
            return sb.Append('"').ToString();
        }
    }
}
