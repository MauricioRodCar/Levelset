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
}
export type EngineEventName = keyof EngineEventMap;
export const ENGINE_EVENT_NAMES: readonly EngineEventName[] = [
  'run.updated',
  'step.updated',
  'ticket.created',
  'alert.rung',
  'status.changed',
];
