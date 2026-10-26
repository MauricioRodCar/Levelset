/**
 * /ai/* in the mock engine (browser demo + tests). Canned answers built from the TSLA demo data,
 * in English and Spanish, with the same rules as the engine: off by default, soft monthly cap,
 * usage and cost per answer, citations and the disclaimer key. The browser demo never holds a
 * Claude key; the mock pretends one is present so the feature can be tried.
 */
import { http, HttpResponse, type JsonBodyType } from 'msw';
import type {
  AiAnswer,
  AiChatRequest,
  AiCitation,
  AiCoachRequest,
  AiExplainRequest,
  AiLang,
  AiModel,
  AiSettingsUpdate,
  AiStatus,
} from '../types';
import { db } from './db';
import * as fx from './fixtures';

const MODEL_IDS: Record<AiModel, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
};
/** USD per 1M tokens (input, output), same table as the engine (ai/pricing.py). */
const PRICES: Record<AiModel, [number, number]> = {
  haiku: [0.1, 0.5],
  sonnet: [2, 10],
  opus: [4, 20],
};
const MONTH = '2026-10';

const json = <T extends JsonBodyType>(data: T, status = 200) => HttpResponse.json(data, { status });
const problem = (status: number, code: string, title: string, detail?: string) =>
  HttpResponse.json(
    { title, detail, code },
    { status, headers: { 'Content-Type': 'application/problem+json' } },
  );

export function aiStatus(): AiStatus {
  const { settings, keyPresent, spentUsd } = db.ai;
  const reason = !settings.enabled
    ? 'disabled'
    : !keyPresent
      ? 'no_key'
      : spentUsd >= settings.monthlyCapUsd
        ? 'cap_reached'
        : null;
  return {
    keyPresent,
    enabled: settings.enabled,
    ready: reason === null,
    reason,
    model: settings.model,
    modelId: MODEL_IDS[settings.model],
    month: MONTH,
    monthlyCapUsd: settings.monthlyCapUsd,
    spentThisMonthUsd: round6(spentUsd),
    remainingUsd: round6(Math.max(0, settings.monthlyCapUsd - spentUsd)),
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function notReady(): Response | null {
  const s = aiStatus();
  if (s.reason === 'disabled') return problem(409, 'ai_disabled', 'AI is turned off in Settings');
  if (s.reason === 'no_key') return problem(409, 'ai_no_key', 'No Claude API key');
  if (s.reason === 'cap_reached')
    return problem(429, 'ai_cap_reached', 'Monthly AI spending cap reached');
  return null;
}

function answer(lang: AiLang, text: string, citations: AiCitation[], inputTokens: number): AiAnswer {
  const model = db.ai.settings.model;
  const outputTokens = Math.round(text.length / 3.6);
  const [pin, pout] = PRICES[model];
  const costUsd = round6((inputTokens * pin + outputTokens * pout) / 1e6);
  db.ai.spentUsd += costUsd;
  return {
    text,
    lang,
    citations,
    usage: { inputTokens, outputTokens, costUsd },
    model: MODEL_IDS[model],
    disclaimerKey: 'ai.disclaimer',
  };
}

const L = (lang: AiLang, en: string, es: string) => (lang === 'es' ? es : en);

const cite = {
  run: (lang: AiLang, id: string): AiCitation => ({
    tool: 'get_run',
    label: L(lang, `Pipeline run ${id}`, `Corrida del pipeline ${id}`),
    ref: { kind: 'run', id },
    params: { runId: id },
  }),
  ticket: (_lang: AiLang, id: string): AiCitation => ({
    tool: 'get_ticket',
    label: `Ticket ${id}`,
    ref: { kind: 'ticket', id },
    params: { ticketId: id },
  }),
  settings: (lang: AiLang): AiCitation => ({
    tool: 'get_settings',
    label: L(lang, 'Your settings and limits', 'Tu configuración y límites'),
    ref: { kind: 'settings', id: 'settings' },
  }),
  news: (lang: AiLang, tickers: string[]): AiCitation => ({
    tool: 'get_news',
    label: L(lang, `News, ${tickers.join(', ')}`, `Noticias, ${tickers.join(', ')}`),
    ref: { kind: 'news', id: tickers.join(', ') },
    params: { tickers },
  }),
  analyst: (lang: AiLang, symbol: string): AiCitation => ({
    tool: 'get_analyst',
    label: L(lang, `Earnings report, ${symbol}`, `Reporte de resultados, ${symbol}`),
    ref: { kind: 'analyst', id: symbol },
    params: { symbol },
  }),
  paperStats: (lang: AiLang, from: string, to: string): AiCitation => ({
    tool: 'get_paper_stats',
    label: L(lang, `Paper stats (${from} – ${to})`, `Estadísticas en papel (${from} – ${to})`),
    ref: { kind: 'paper_account', id: 'active' },
    params: { from, to },
  }),
  fills: (lang: AiLang): AiCitation => ({
    tool: 'get_fills',
    label: L(lang, 'Your recorded fills', 'Tus operaciones registradas'),
  }),
};

function explainText(req: AiExplainRequest): { text: string; citations: AiCitation[] } | Response {
  const lang = req.lang;
  switch (req.kind) {
    case 'pipeline_step': {
      if (!req.runId || !req.stepKey)
        return problem(422, 'validation_error', 'Invalid request', 'runId and stepKey are required');
      const run = db.runs.find((r) => r.id === req.runId);
      if (!run) return problem(404, 'not_found', 'Run not found', req.runId);
      const step = run.steps.find((s) => s.key === req.stepKey);
      if (!step) return problem(404, 'not_found', 'Step not found', req.stepKey);
      return {
        citations: [cite.run(lang, run.id)],
        text: L(
          lang,
          `The **${req.stepKey}** step of this ${run.ticker ?? ''} run ended as **${step.status}**.\n\n` +
            '- It reads the outputs of the step before it and applies your own rules (entry window, stop method, target R, limits).\n' +
            '- For the TSLA demo the plan is entry 364.18, stop loss 358.32 (opening-range midpoint) and take profit 370.04 (2R), sized to 8 shares.\n' +
            '- In the Time Machine replay, 29.4% of past sessions reached the target first, 25.5% the stop first and 45.1% neither by the close. Those are historical statistics, not a forecast.\n\n' +
            'Data used: the step inputs and outputs of this run.',
          `El paso **${req.stepKey}** de esta corrida de ${run.ticker ?? ''} terminó como **${step.status}**.\n\n` +
            '- Lee las salidas del paso anterior y aplica tus propias reglas (ventana de entrada, método de stop, R objetivo, límites).\n' +
            '- En el demo de TSLA el plan es entrada 364.18, stop loss 358.32 (mitad del rango de apertura) y take profit 370.04 (2R), con 8 acciones.\n' +
            '- En la repetición del Time Machine, el 29.4 % de las sesiones pasadas llegó primero al objetivo, el 25.5 % primero al stop y el 45.1 % a ninguno antes del cierre. Son estadísticas históricas, no un pronóstico.\n\n' +
            'Datos usados: las entradas y salidas de este paso.',
        ),
      };
    }
    case 'blocked_ticket': {
      if (!req.ticketId)
        return problem(422, 'validation_error', 'Invalid request', 'ticketId is required');
      const tk = db.tickets.find((x) => x.id === req.ticketId);
      if (!tk) return problem(404, 'ticket_not_found', 'Ticket not found', req.ticketId);
      const detail = tk.riskDetail?.[0] ?? '';
      return {
        citations: [cite.ticket(lang, tk.id), cite.settings(lang)],
        text: L(
          lang,
          `The risk check blocked this ${tk.symbol} ticket (**${(tk.riskReasons ?? []).join(', ') || 'no reason recorded'}**).\n\n` +
            `- ${detail || 'The ticket broke one of your limits.'}\n` +
            `- It would pass if less risk were already open today, if the loss at the stop (${tk.maxLoss.toFixed(2)}) were smaller, for example with a smaller position, or if you raised your own daily loss limit in Settings.\n\n` +
            'The limit is there to protect the day: changing it is your decision, not a fix for this ticket.',
          `La revisión de riesgo bloqueó este ticket de ${tk.symbol} (**${(tk.riskReasons ?? []).join(', ') || 'sin motivo registrado'}**).\n\n` +
            `- ${detail || 'El ticket superó uno de tus límites.'}\n` +
            `- Pasaría si hoy hubiera menos riesgo abierto, si la pérdida en el stop (${tk.maxLoss.toFixed(2)}) fuera menor, por ejemplo con una posición más chica, o si subieras tu propio límite de pérdida diaria en Configuración.\n\n` +
            'El límite está para proteger el día: cambiarlo es decisión tuya, no un arreglo para este ticket.',
        ),
      };
    }
    case 'news_summary': {
      const tickers = req.tickers?.length ? req.tickers : db.watchlist.map((w) => w.symbol);
      const n = db.news.filter((x) => tickers.includes(x.symbol)).length;
      return {
        citations: [cite.news(lang, tickers)],
        text: L(
          lang,
          `${n} headlines for ${tickers.join(', ')} in the last ${req.hours ?? 12} hours.\n\n` +
            '- **TSLA**: delivery and analyst items; nothing the News step treats as a risk today.\n' +
            '- **NVDA, AAPL, AMD**: routine coverage, no earnings this week.\n\n' +
            'Headlines explain what is being talked about, not where a price goes next.',
          `${n} titulares de ${tickers.join(', ')} en las últimas ${req.hours ?? 12} horas.\n\n` +
            '- **TSLA**: entregas y notas de analistas; nada que el paso de Noticias trate como riesgo hoy.\n' +
            '- **NVDA, AAPL, AMD**: cobertura de rutina, sin resultados esta semana.\n\n' +
            'Los titulares explican de qué se habla, no hacia dónde va un precio.',
        ),
      };
    }
    case 'analyst_quarter': {
      if (!req.symbol)
        return problem(422, 'validation_error', 'Invalid request', 'symbol is required');
      const symbol = req.symbol.toUpperCase();
      return {
        citations: [cite.analyst(lang, symbol)],
        text: L(
          lang,
          `**${symbol}, latest quarter** (from SEC filings):\n\n` +
            '- Revenue grew against the same quarter a year earlier, while gross margin was a little lower.\n' +
            '- Operating margin moved less than revenue, so costs grew too.\n' +
            '- Check the 10-Q for one-off items before reading too much into net income.\n\n' +
            'This describes reported numbers only; it is not a valuation or a price view.',
          `**${symbol}, último trimestre** (de los reportes a la SEC):\n\n` +
            '- Los ingresos crecieron contra el mismo trimestre del año anterior, mientras el margen bruto bajó un poco.\n' +
            '- El margen operativo se movió menos que los ingresos, así que los costos también crecieron.\n' +
            '- Revisa el 10-Q por partidas únicas antes de sacar conclusiones de la utilidad neta.\n\n' +
            'Esto describe solo números reportados; no es una valuación ni una opinión de precio.',
        ),
      };
    }
  }
}

export function makeAiHandlers(P: string, latency: () => Promise<void>) {
  return [
    http.put(`${P}/ai/key`, async ({ request }) => {
      await latency();
      const body = (await request.json()) as { key?: string };
      if (!/^sk-ant-[A-Za-z0-9_-]{16,}$/.test(body.key?.trim() ?? ''))
        return problem(422, 'invalid_ai_key', 'This does not look like a Claude API key');
      db.ai.keyPresent = true;
      return new HttpResponse(null, { status: 204 });
    }),

    http.delete(`${P}/ai/key`, async () => {
      await latency();
      db.ai.keyPresent = false;
      return new HttpResponse(null, { status: 204 });
    }),

    http.get(`${P}/ai/status`, async () => {
      await latency();
      return json(aiStatus());
    }),

    http.get(`${P}/ai/settings`, async () => {
      await latency();
      return json(db.ai.settings);
    }),

    http.patch(`${P}/ai/settings`, async ({ request }) => {
      await latency();
      const body = (await request.json()) as AiSettingsUpdate;
      const cap = body.monthlyCapUsd;
      if (cap !== undefined && !(cap >= 0 && cap <= 1000))
        return problem(422, 'validation_error', 'Invalid request', 'monthlyCapUsd: 0 to 1000');
      if (body.model !== undefined && !(body.model in MODEL_IDS))
        return problem(422, 'validation_error', 'Invalid request', 'model: haiku, sonnet or opus');
      db.ai.settings = {
        enabled: body.enabled ?? db.ai.settings.enabled,
        model: body.model ?? db.ai.settings.model,
        monthlyCapUsd: cap ?? db.ai.settings.monthlyCapUsd,
      };
      return json(db.ai.settings);
    }),

    http.post(`${P}/ai/explain`, async ({ request }) => {
      await latency();
      const blocked = notReady();
      if (blocked) return blocked;
      const req = (await request.json()) as AiExplainRequest;
      const out = explainText(req);
      if (out instanceof Response) return out;
      return json(answer(req.lang, out.text, out.citations, 2400));
    }),

    http.post(`${P}/ai/coach`, async ({ request }) => {
      await latency();
      const blocked = notReady();
      if (blocked) return blocked;
      const req = (await request.json()) as AiCoachRequest;
      if (req.from > req.to)
        return problem(422, 'validation_error', 'Invalid request', 'from must be on or before to');
      const text = L(
        req.lang,
        `Review of ${req.from} – ${req.to}:\n\n` +
          '- Your paper account followed every signal; your manual fills cover fewer days, so compare only the matched rows.\n' +
          '- Your manual exits come earlier than the plan on winning days: you often close before the take profit.\n' +
          '- Losses cluster after 14:00 ET.\n\n' +
          '**Experiments to try on paper:**\n' +
          '- Compare 1R and 2R targets for the next 20 trades.\n' +
          '- Log every early exit with a one-line reason and review them on Friday.\n\n' +
          'These are experiments, not rule changes; your settings stay as they are.',
        `Revisión de ${req.from} – ${req.to}:\n\n` +
          '- Tu cuenta en papel siguió todas las señales; tus operaciones manuales cubren menos días, así que compara solo las filas que coinciden.\n' +
          '- En días ganadores sales antes que el plan: muchas veces cierras antes del take profit.\n' +
          '- Las pérdidas se concentran después de las 14:00 ET.\n\n' +
          '**Experimentos para probar en papel:**\n' +
          '- Compara objetivos de 1R y 2R durante las próximas 20 operaciones.\n' +
          '- Anota cada salida anticipada con un motivo de una línea y revísalas el viernes.\n\n' +
          'Son experimentos, no cambios de reglas; tu configuración queda igual.',
      );
      return json(
        answer(
          req.lang,
          text,
          [cite.paperStats(req.lang, req.from, req.to), cite.fills(req.lang), cite.settings(req.lang)],
          5200,
        ),
      );
    }),

    http.post(`${P}/ai/chat`, async ({ request }) => {
      await latency();
      const blocked = notReady();
      if (blocked) return blocked;
      const req = (await request.json()) as AiChatRequest;
      const last = req.messages[req.messages.length - 1];
      if (!last || last.role !== 'user')
        return problem(422, 'validation_error', 'Invalid request', 'the last message must be from the user');
      const q = last.content.toLowerCase();
      const call = /\b(buy|sell|comprar|compro|vender|vendo|target|objetivo|precio|price|predic)/.test(q);
      const text = call
        ? L(
            req.lang,
            "I can't make trade calls or price predictions, so I won't say whether to buy or sell or where the price is going.\n\n" +
              'What I can do instead: explain your TSLA ticket (entry 364.18, stop loss 358.32, take profit 370.04, 8 shares), review whether it fits your limits, or compare your paper results with your manual fills.',
            'No puedo hacer recomendaciones de compra o venta ni predecir precios, así que no voy a decir si comprar o vender ni hacia dónde va el precio.\n\n' +
              'Lo que sí puedo hacer: explicar tu ticket de TSLA (entrada 364.18, stop loss 358.32, take profit 370.04, 8 acciones), revisar si cabe en tus límites o comparar tus resultados en papel con tus operaciones manuales.',
          )
        : L(
            req.lang,
            'From your demo data: the TSLA ticket risks 46.88 at the stop (8 shares × 5.86), within your max loss per trade. The Time Machine replay had the target first in 29.4% of past sessions.\n\n' +
              'Ask me about your tickets, runs, paper results or settings.',
            'Según tus datos del demo: el ticket de TSLA arriesga 46.88 en el stop (8 acciones × 5.86), dentro de tu pérdida máxima por operación. En la repetición del Time Machine el objetivo llegó primero en el 29.4 % de las sesiones pasadas.\n\n' +
              'Pregúntame por tus tickets, corridas, resultados en papel o configuración.',
          );
      return json(
        answer(
          req.lang,
          text,
          call ? [] : [cite.ticket(req.lang, fx.TSLA_TICKET_ID), cite.settings(req.lang)],
          1800 + req.messages.length * 120,
        ),
      );
    }),
  ];
}
