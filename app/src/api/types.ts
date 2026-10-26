/** Friendly aliases for the generated OpenAPI schema types. Regenerate with `npm run api:types`. */
import type { components } from './schema';

type S = components['schemas'];

export type Problem = S['Problem'];
export type Status = S['Status'];
export type DashboardSummary = S['DashboardSummary'];
export type Settings = S['Settings'];
export type ScanRequest = S['ScanRequest'];
export type ScanResult = S['ScanResult'];
export type ScanHit = S['ScanHit'];
export type WatchItem = S['WatchItem'];
export type NewsItem = S['NewsItem'];
export type Bar = S['Bar'];
export type Bars = S['Bars'];
export type StepKey = S['StepKey'];
export type StepStatus = S['StepStatus'];
export type Step = S['Step'];
export type PipelineRunRequest = S['PipelineRunRequest'];
export type PipelineRunSummary = S['PipelineRunSummary'];
export type PipelineRun = S['PipelineRun'];
export type Ticket = S['Ticket'];
export type TicketStatus = Ticket['status'];
export type TimeMachine = NonNullable<Ticket['timeMachine']>;
export type OpenTrade = S['OpenTrade'];
export type FillCreate = S['FillCreate'];
export type Fill = S['Fill'];
export type AlertCreate = S['AlertCreate'];
export type Alert = S['Alert'];
export type AlertType = AlertCreate['type'];
export type AlertUpdate = S['AlertUpdate'];

// v1.1 — paper account
export type TicketPaper = S['TicketPaper'];
export type PaperExitReason = S['PaperExitReason'];
export type PaperSkipReason = S['PaperSkipReason'];
export type PaperPeriod = S['PaperPeriod'];
export type PaperAccount = S['PaperAccount'];
export type PaperAccountCreate = S['PaperAccountCreate'];
export type PaperAccountReset = S['PaperAccountReset'];
export type PaperPosition = S['PaperPosition'];
export type PaperTrade = S['PaperTrade'];
export type PaperEquityPoint = S['PaperEquityPoint'];
export type PaperBreakdownRow = S['PaperBreakdownRow'];
export type PaperStats = S['PaperStats'];
export type PaperGroupBy = NonNullable<PaperStats['groupBy']>;
export type PaperCompareSide = S['PaperCompareSide'];
export type PaperCompareRow = S['PaperCompareRow'];
export type PaperComparison = S['PaperComparison'];
export type PaperSettings = S['PaperSettings'];
export type PaperSettingsUpdate = S['PaperSettingsUpdate'];
export type PaperBackfill = S['PaperBackfill'];
export type PaperTradeKindFilter = 'closed' | 'skipped' | 'all';

// v1.1 — AI assistant
export type AiModel = S['AiModel'];
export type AiLang = S['AiLang'];
export type AiKey = S['AiKey'];
export type AiStatus = S['AiStatus'];
export type AiSettings = S['AiSettings'];
export type AiSettingsUpdate = S['AiSettingsUpdate'];
export type AiExplainRequest = S['AiExplainRequest'];
export type AiExplainKind = AiExplainRequest['kind'];
export type AiCoachRequest = S['AiCoachRequest'];
export type AiChatMessage = S['AiChatMessage'];
export type AiChatRequest = S['AiChatRequest'];
export type AiCitation = S['AiCitation'];
export type AiUsage = S['AiUsage'];
export type AiAnswer = S['AiAnswer'];

// v1.1 — analyst
export type AnalystQuarter = S['AnalystQuarter'];
export type AnalystChange = S['AnalystChange'];
export type AnalystChangeCode = AnalystChange['code'];
export type AnalystFiling = S['AnalystFiling'];
export type AnalystReport = S['AnalystReport'];

// v1.1 — congress trades
export type CongressOption = S['CongressOption'];
export type CongressTrade = S['CongressTrade'];
export type CongressTradeType = CongressTrade['type'];
export type CongressFiling = S['CongressFiling'];
export type CongressFeed = S['CongressFeed'];
export type CongressRefreshResult = S['CongressRefreshResult'];
export type CongressSettings = S['CongressSettings'];
export type CongressSettingsUpdate = S['CongressSettingsUpdate'];
export type CongressFilingEvent = S['CongressFilingEvent'];

// v1.1 — platform bridges
export type BridgePlatform = S['BridgePlatform'];
export type BridgeSettings = S['BridgeSettings'];
export type BridgePlatformSettings = S['BridgePlatformSettings'];
export type BridgeSettingsUpdate = S['BridgeSettingsUpdate'];
export type BridgeStatus = S['BridgeStatus'];
export type SymbolMapRow = S['SymbolMapRow'];
export type SymbolMap = S['SymbolMap'];
export type BridgeSendRequest = S['BridgeSendRequest'];
export type BridgeTicketPlatform = S['BridgeTicketPlatform'];
export type BridgeTicketState = S['BridgeTicketState'];
export type BridgeSignal = S['BridgeSignal'];
export type BridgeCancel = S['BridgeCancel'];
export type BridgeAck = S['BridgeAck'];
export type BridgeHeartbeat = S['BridgeHeartbeat'];

export const BRIDGE_PLATFORMS: readonly BridgePlatform[] = ['ctrader', 'mt4', 'mt5'];

export type TicketExportFormat = 'text' | 'csv' | 'json' | 'ctrader' | 'mt4' | 'mt5';
export type TicketListFilter = 'ready' | 'blocked' | 'stale' | 'all';

export const STEP_KEYS: readonly StepKey[] = [
  'scanner',
  'news',
  'entry',
  'exit',
  'timemachine',
  'budget',
  'risk',
  'ticket',
];

/** SSE events from GET /events and their payloads. */
export interface EngineEventMap {
  'run.updated': PipelineRunSummary;
  'step.updated': { runId: string; step: Step };
  'ticket.created': Ticket;
  'alert.rung': Alert;
  'status.changed': Status;
  'paper.opened': PaperPosition;
  'paper.closed': PaperTrade;
  'paper.skipped': PaperTrade;
  'paper.backfilled': PaperBackfill;
  'congress.filing': CongressFilingEvent;
  'bridge.updated': BridgeTicketState;
  'bridge.status': BridgeStatus;
}
export type EngineEventName = keyof EngineEventMap;
export const ENGINE_EVENT_NAMES: readonly EngineEventName[] = [
  'run.updated',
  'step.updated',
  'ticket.created',
  'alert.rung',
  'status.changed',
  'paper.opened',
  'paper.closed',
  'paper.skipped',
  'paper.backfilled',
  'congress.filing',
  'bridge.updated',
  'bridge.status',
];
