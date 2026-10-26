//+------------------------------------------------------------------+
//| Levelset Bridge for MetaTrader 4 (Expert Advisor)                |
//| MIT License - part of Levelset (github.com/MauricioRodCar/Levelset)|
//|                                                                  |
//| Reads Levelset signal files from the terminal's Common Files     |
//| folder (FILE_COMMON): <Common>\Files\Levelset\mt4\signals\*.json |
//| and shows each one on the chart: Entry, Stop loss, Take profit   |
//| (in that order), volume and max loss, with Place and Dismiss.    |
//|                                                                  |
//| NOTHING is sent to the broker unless YOU click Place. There is   |
//| no auto-place option, no timer that places and no "always place" |
//| setting. Dismiss, a cancel file or the expiry only hide a panel. |
//| Writes acks (shown/placed/dismissed/expired/rejected) and a      |
//| heartbeat.json every 5 s so Levelset shows the bridge online.    |
//+------------------------------------------------------------------+
#property copyright "Levelset contributors (MIT)"
#property link      "https://github.com/MauricioRodCar/Levelset"
#property version   "1.10"
#property strict

input string InpFolder = "Levelset";   // Folder inside Common\Files (Levelset's signals folder)
input int    InpMagic  = 26101901;     // Magic number for orders placed from a panel
input int    InpSlippage = 10;         // Max slippage in points for market orders

#define BRIDGE_VERSION "1.1.0"
#define PLATFORM       "mt4"
#define PFX            "LSB_"

string   g_dir;              // Levelset\mt4
string   g_id = "";           // signal on screen ("" = none)
string   g_sig = "";          // its raw JSON
string   g_done[];            // signal ids already handled
string   g_missing[];         // broker symbols this terminal does not know
datetime g_lastBeat = 0;
string   g_error = "";

//+------------------------------------------------------------------+
int OnInit()
  {
   g_dir = InpFolder + "\\" + PLATFORM;
   EventSetTimer(1);
   Scan();
   WriteHeartbeat();
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   HidePanel();
  }

void OnTimer()
  {
   Scan();
   if(TimeGMT() - g_lastBeat >= 5)
      WriteHeartbeat();
  }

void OnTick() {}

//+------------------------------------------------------------------+
//| Flat JSON helpers (Levelset files are one flat object)           |
//+------------------------------------------------------------------+
string JsonRaw(const string json, const string key)
  {
   string pat = "\"" + key + "\"";
   int p = StringFind(json, pat);
   if(p < 0) return("");
   p = StringFind(json, ":", p + StringLen(pat));
   if(p < 0) return("");
   p++;
   int n = StringLen(json);
   while(p < n && (StringGetCharacter(json, p) == ' ')) p++;
   if(p >= n) return("");
   if(StringGetCharacter(json, p) == '"')
     {
      string out = "";
      p++;
      while(p < n)
        {
         ushort c = StringGetCharacter(json, p);
         if(c == '"') break;
         if(c == '\\' && p + 1 < n)
           {
            p++;
            c = StringGetCharacter(json, p);
            if(c == 'n') c = '\n';
            else if(c == 't') c = '\t';
           }
         out += ShortToString(c);
         p++;
        }
      return(out);
     }
   int e = p;
   while(e < n)
     {
      ushort c = StringGetCharacter(json, e);
      if(c == ',' || c == '}' || c == ']') break;
      e++;
     }
   while(e > p && StringGetCharacter(json, e - 1) == ' ') e--;
   return(StringSubstr(json, p, e - p));
  }

double JsonNum(const string json, const string key) { return(StringToDouble(JsonRaw(json, key))); }
long   JsonLong(const string json, const string key) { return(StringToInteger(JsonRaw(json, key))); }

string Quote(const string v)
  {
   string s = v;
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\r", " ");
   return("\"" + s + "\"");
  }

//+------------------------------------------------------------------+
//| Files (UTF-8, Common folder, temp file + rename)                 |
//+------------------------------------------------------------------+
string ReadFile(const string path)
  {
   int h = FileOpen(path, FILE_READ | FILE_BIN | FILE_COMMON | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(h == INVALID_HANDLE) return("");
   uchar buf[];
   int size = (int)FileSize(h);
   string s = "";
   if(size > 0 && FileReadArray(h, buf, 0, size) == size)
      s = CharArrayToString(buf, 0, size, CP_UTF8);
   FileClose(h);
   return(s);
  }

bool WriteFile(const string path, const string text)
  {
   string tmp = path + ".tmp";
   int h = FileOpen(tmp, FILE_WRITE | FILE_BIN | FILE_COMMON);
   if(h == INVALID_HANDLE) return(false);
   uchar buf[];
   int n = StringToCharArray(text, buf, 0, WHOLE_ARRAY, CP_UTF8);
   if(n > 0 && buf[n - 1] == 0) n--;   // no terminating zero in the file
   FileWriteArray(h, buf, 0, n);
   FileClose(h);
   return(FileMove(tmp, FILE_COMMON, path, FILE_COMMON | FILE_REWRITE));
  }

bool Exists(const string path) { return(FileIsExist(path, FILE_COMMON)); }

bool IsDone(const string id)
  {
   for(int i = 0; i < ArraySize(g_done); i++)
      if(g_done[i] == id) return(true);
   return(false);
  }

void MarkDone(const string id)
  {
   if(IsDone(id)) return;
   int n = ArraySize(g_done);
   ArrayResize(g_done, n + 1);
   g_done[n] = id;
  }

void AddMissing(const string sym)
  {
   for(int i = 0; i < ArraySize(g_missing); i++)
      if(g_missing[i] == sym) return;
   int n = ArraySize(g_missing);
   ArrayResize(g_missing, n + 1);
   g_missing[n] = sym;
  }

bool AckIsFinal(const string id)
  {
   string path = g_dir + "\\acks\\" + id + ".json";
   if(!Exists(path)) return(false);
   string st = JsonRaw(ReadFile(path), "state");
   return(st == "placed" || st == "dismissed" || st == "expired" || st == "rejected");
  }

void WriteAck(const string sig, const string state, const string error)
  {
   string id = JsonRaw(sig, "signalId");
   string s = "{\"schema\":\"levelset.ack/1\",\"signalId\":" + Quote(id) +
              ",\"ticketId\":" + Quote(JsonRaw(sig, "ticketId")) +
              ",\"platform\":\"" + PLATFORM + "\",\"state\":\"" + state +
              "\",\"timeUnix\":" + IntegerToString((long)TimeGMT()) +
              ",\"error\":" + Quote(error) + "}";
   if(!WriteFile(g_dir + "\\acks\\" + id + ".json", s))
      Print("Levelset Bridge: ack not written, error ", GetLastError());
  }

void WriteHeartbeat()
  {
   g_lastBeat = TimeGMT();
   string err = g_error;
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      err = "Algo Trading is off in the terminal: Place cannot send the order";
   string miss = "";
   for(int i = 0; i < ArraySize(g_missing); i++)
      miss += (i > 0 ? "," : "") + Quote(g_missing[i]);
   bool demo = AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO;
   string s = "{\"schema\":\"levelset.heartbeat/1\",\"platform\":\"" + PLATFORM +
              "\",\"bridgeVersion\":\"" + BRIDGE_VERSION +
              "\",\"platformVersion\":\"" + IntegerToString(TerminalInfoInteger(TERMINAL_BUILD)) +
              "\",\"state\":\"" + (err == "" ? "running" : "error") +
              "\",\"accountIsDemo\":" + (demo ? "true" : "false") +
              ",\"broker\":" + Quote(AccountInfoString(ACCOUNT_COMPANY)) +
              ",\"timeUnix\":" + IntegerToString((long)TimeGMT()) +
              ",\"pendingSignals\":" + (g_id == "" ? "0" : "1") +
              ",\"missingSymbols\":[" + miss + "],\"error\":" + Quote(err) + "}";
   WriteFile(g_dir + "\\heartbeat.json", s);
  }

//+------------------------------------------------------------------+
//| Scan signals / cancels / expiry                                  |
//+------------------------------------------------------------------+
void Scan()
  {
   long now = (long)TimeGMT();
   if(g_id != "")
     {
      if(Exists(g_dir + "\\cancel\\" + g_id + ".json"))
        { MarkDone(g_id); HidePanel(); }
      else if(JsonLong(g_sig, "expiresAtUnix") <= now)
        { MarkDone(g_id); WriteAck(g_sig, "expired", ""); HidePanel(); }
      else
         return;   // one panel at a time; the next one appears after this
     }
   string name;
   long h = FileFindFirst(g_dir + "\\signals\\*.json", name, FILE_COMMON);
   if(h == INVALID_HANDLE) return;
   do
     {
      string id = StringSubstr(name, 0, StringLen(name) - 5);
      if(IsDone(id)) continue;
      string sig = ReadFile(g_dir + "\\signals\\" + name);
      if(sig == "" || JsonRaw(sig, "schema") != "levelset.signal/1") continue;   // half written: retry
      if(JsonRaw(sig, "platform") != PLATFORM || Exists(g_dir + "\\cancel\\" + id + ".json") || AckIsFinal(id))
        { MarkDone(id); continue; }
      if(JsonLong(sig, "expiresAtUnix") <= now)
        { MarkDone(id); WriteAck(sig, "expired", ""); continue; }
      ShowPanel(id, sig);
      break;
     }
   while(FileFindNext(h, name));
   FileFindClose(h);
  }

//+------------------------------------------------------------------+
//| The panel                                                        |
//+------------------------------------------------------------------+
void Label(const string name, const string text, int x, int y, int size, color clr)
  {
   ObjectCreate(0, PFX + name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, PFX + name, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, PFX + name, OBJPROP_ANCHOR, ANCHOR_RIGHT_UPPER);
   ObjectSetInteger(0, PFX + name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, PFX + name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, PFX + name, OBJPROP_FONTSIZE, size);
   ObjectSetInteger(0, PFX + name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, PFX + name, OBJPROP_SELECTABLE, false);
   ObjectSetString(0, PFX + name, OBJPROP_FONT, "Segoe UI");
   ObjectSetString(0, PFX + name, OBJPROP_TEXT, text);
  }

void Btn(const string name, const string text, int x, int y, color bg, bool enabled)
  {
   ObjectCreate(0, PFX + name, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, PFX + name, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, PFX + name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, PFX + name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, PFX + name, OBJPROP_XSIZE, 110);
   ObjectSetInteger(0, PFX + name, OBJPROP_YSIZE, 28);
   ObjectSetInteger(0, PFX + name, OBJPROP_BGCOLOR, enabled ? bg : clrDimGray);
   ObjectSetInteger(0, PFX + name, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, PFX + name, OBJPROP_STATE, false);
   ObjectSetInteger(0, PFX + name, OBJPROP_SELECTABLE, false);
   ObjectSetString(0, PFX + name, OBJPROP_TEXT, text);
  }

void ShowPanel(const string id, const string sig)
  {
   HidePanel();
   g_id = id;
   g_sig = sig;
   string sym = JsonRaw(sig, "brokerSymbol");
   bool known = SymbolSelect(sym, true);
   if(!known) AddMissing(sym);
   color fg = C'230,237,243', muted = C'154,167,181';
   int x = 20, y = 30;
   ObjectCreate(0, PFX + "bg", OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, PFX + "bg", OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(0, PFX + "bg", OBJPROP_XDISTANCE, 270);
   ObjectSetInteger(0, PFX + "bg", OBJPROP_YDISTANCE, 20);
   ObjectSetInteger(0, PFX + "bg", OBJPROP_XSIZE, 260);
   ObjectSetInteger(0, PFX + "bg", OBJPROP_YSIZE, 330);
   ObjectSetInteger(0, PFX + "bg", OBJPROP_BGCOLOR, C'18,26,36');
   ObjectSetInteger(0, PFX + "bg", OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, PFX + "bg", OBJPROP_COLOR, C'58,74,94');
   ObjectSetInteger(0, PFX + "bg", OBJPROP_SELECTABLE, false);

   bool buy = JsonRaw(sig, "side") != "sell";
   Label("title", "Levelset  " + (buy ? "BUY " : "SELL ") + JsonRaw(sig, "qtyShares") + " " + JsonRaw(sig, "usSymbol"),
         x, y, 11, fg);
   Label("sub", (JsonRaw(sig, "orderType") == "limit" ? "Limit" : "Market") + " order on " + sym, x, y + 22, 8, muted);
   // Ticket levels: Entry -> Stop loss -> Take profit, largest text, neutral colour.
   string names[3] = {"Entry", "Stop loss", "Take profit"};
   string keys[3]  = {"entry", "stopLoss", "takeProfit"};
   for(int i = 0; i < 3; i++)
     {
      Label("l" + IntegerToString(i), names[i], x, y + 44 + i * 46, 8, muted);
      Label("v" + IntegerToString(i), DoubleToString(JsonNum(sig, keys[i]), 2), x, y + 58 + i * 46, 15, fg);
     }
   Label("vol", "Volume " + JsonRaw(sig, "volume") + " " + JsonRaw(sig, "volumeUnit") +
         "   Max loss $" + JsonRaw(sig, "maxLossUsd"), x, y + 190, 8, muted);
   Label("flat", "Flat by " + JsonRaw(sig, "flatBy") + " ET", x, y + 208, 8, muted);
   Label("note", known ? "Nothing is sent until you click Place." : "Symbol " + sym + " not found: fix the symbol map.",
         x, y + 228, 8, muted);
   Btn("place", "Place", 140, y + 256, C'31,111,235', known);
   Btn("dismiss", "Dismiss", 20, y + 256, C'58,70,86', true);
   ChartRedraw();
   WriteAck(sig, "shown", "");
  }

void HidePanel()
  {
   for(int i = ObjectsTotal(0, -1, -1) - 1; i >= 0; i--)
     {
      string n = ObjectName(0, i, -1, -1);
      if(StringFind(n, PFX) == 0) ObjectDelete(0, n);
     }
   g_id = "";
   g_sig = "";
   ChartRedraw();
  }

void Finish(const string state, const string error)
  {
   MarkDone(g_id);
   WriteAck(g_sig, state, error);
   if(error != "") Print("Levelset Bridge: ", state, ": ", error);
   HidePanel();
  }

//+------------------------------------------------------------------+
//| Clicks: Place is the user's explicit decision                    |
//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id != CHARTEVENT_OBJECT_CLICK || g_id == "") return;
   if(sparam == PFX + "dismiss")
      Finish("dismissed", "");
   else if(sparam == PFX + "place")
     {
      ObjectSetInteger(0, PFX + "place", OBJPROP_STATE, false);
      Place();
     }
  }

string ErrText(int code)
  {
   return("error " + IntegerToString(code));
  }

void Place()
  {
   string sig = g_sig;
   if(Exists(g_dir + "\cancel\\" + g_id + ".json")) { MarkDone(g_id); HidePanel(); return; }
   if(JsonLong(sig, "expiresAtUnix") <= (long)TimeGMT()) { Finish("expired", ""); return; }
   string sym = JsonRaw(sig, "brokerSymbol");
   if(!SymbolSelect(sym, true)) { Finish("rejected", "symbol " + sym + " not found at this broker"); return; }

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double entry = NormalizeDouble(JsonNum(sig, "entry"), digits);
   double sl = NormalizeDouble(JsonNum(sig, "stopLoss"), digits);
   double tp = NormalizeDouble(JsonNum(sig, "takeProfit"), digits);
   double step = MarketInfo(sym, MODE_LOTSTEP);
   double vmin = MarketInfo(sym, MODE_MINLOT);
   double vol = JsonNum(sig, "volume");
   if(step > 0) vol = MathFloor(vol / step + 1e-9) * step;   // never round up: risk must not grow
   vol = NormalizeDouble(vol, 8);
   if(vol < vmin) { Finish("rejected", "volume " + JsonRaw(sig, "volume") + " is below this symbol's minimum " +
                           DoubleToString(vmin, 2)); return; }

   bool buy = JsonRaw(sig, "side") != "sell";
   string comment = JsonRaw(sig, "comment");
   RefreshRates();
   double bid = SymbolInfoDouble(sym, SYMBOL_BID), ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   int ticket, err = 0;
   if(JsonRaw(sig, "orderType") == "limit")
     {
      // MT4: the pending order has no expiry here (many brokers refuse one); delete it yourself by the flat-by time.
      ticket = OrderSend(sym, buy ? OP_BUYLIMIT : OP_SELLLIMIT, vol, entry, InpSlippage, sl, tp, comment, InpMagic, 0, clrNONE);
      if(ticket < 0) err = GetLastError();
     }
   else
     {
      bool sane = buy ? (bid > sl && ask < tp) : (ask < sl && bid > tp);
      if(!sane) { Finish("rejected", "price is already past the stop loss or the take profit"); return; }
      double price = NormalizeDouble(buy ? ask : bid, digits);
      ticket = OrderSend(sym, buy ? OP_BUY : OP_SELL, vol, price, InpSlippage, sl, tp, comment, InpMagic, 0, clrNONE);
      if(ticket < 0) err = GetLastError();
      if(ticket < 0 && err == 130)
        {
         // Market-execution accounts may refuse stops on the market order: open it, then add them at once.
         ticket = OrderSend(sym, buy ? OP_BUY : OP_SELL, vol, price, InpSlippage, 0, 0, comment, InpMagic, 0, clrNONE);
         if(ticket < 0) err = GetLastError();
         if(ticket >= 0 && OrderSelect(ticket, SELECT_BY_TICKET))
           {
            if(!OrderModify(ticket, OrderOpenPrice(), sl, tp, 0, clrNONE))
               Alert("Levelset Bridge: the position on ", sym, " is open WITHOUT stop loss / take profit (",
                     ErrText(GetLastError()), "). Set them now: SL ", DoubleToString(sl, digits), " TP ",
                     DoubleToString(tp, digits));
           }
        }
     }
   if(ticket >= 0)
     {
      Print("Levelset Bridge: placed ", sym, " ", vol, " SL ", sl, " TP ", tp, " (clicked Place)");
      Finish("placed", "");
     }
   else
      Finish("rejected", ErrText(err));
  }
//+------------------------------------------------------------------+
