import * as fx from './fixtures';
import { historyRuns } from './pipelineScenarios';
import { freshPaper, withTicketPaper, type PaperMockState } from './paperFixtures';
import { freshResearch, type ResearchMockState } from './researchFixtures';
import { freshBridges, type BridgeMockState } from './bridgeFixtures';
import { freshAi, type AiMockState } from './aiFixtures';
import type {
  Alert,
  Fill,
  NewsItem,
  OpenTrade,
  PipelineRun,
  Settings,
  Ticket,
  WatchItem,
  DashboardSummary,
} from '../types';

export interface MockDb {
  settings: Settings;
  watchlist: WatchItem[];
  news: NewsItem[];
  runs: PipelineRun[];
  tickets: Ticket[];
  trades: OpenTrade[];
  fills: Fill[];
  alerts: Alert[];
  dashboard: DashboardSummary;
  /** v1.1 paper account (paperFixtures.ts / paperMock.ts). */
  paper: PaperMockState;
  /** v1.1 analyst + congress trades (researchFixtures.ts / researchMock.ts). */
  research: ResearchMockState;
  /** v1.1 platform bridges (bridgeFixtures.ts / bridgeMock.ts). */
  bridges: BridgeMockState;
  /** v1.1 AI assistant (aiFixtures.ts / aiMock.ts). */
  ai: AiMockState;
  seq: number;
}

const clone = <T>(v: T): T => structuredClone(v);

function fresh(): MockDb {
  const paper = freshPaper();
  return {
    settings: clone(fx.settings),
    watchlist: clone(fx.watchlist),
    news: clone(fx.news),
    runs: historyRuns(),
    tickets: withTicketPaper(clone(fx.tickets), paper),
    trades: clone(fx.trades),
    fills: clone(fx.fills),
    alerts: clone(fx.alerts),
    dashboard: clone(fx.dashboard),
    paper,
    research: freshResearch(),
    bridges: freshBridges(),
    ai: freshAi(),
    seq: 1,
  };
}

/** Mutable in-memory state of the mock engine. `resetMockDb()` restores the fixtures. */
export let db: MockDb = fresh();

export function resetMockDb() {
  db = fresh();
}

export const mockConfig = {
  /** Delay between simulated pipeline steps in run-all mode. */
  stepDelayMs: 650,
  /** Artificial latency per request (0 in tests). */
  latencyMs: 120,
  /** Wall-clock time the mock started; the demo clock advances from DEMO_NOW. */
  startedAt: Date.now(),
};

/** Current demo time: pinned 10:15 ET plus the time elapsed since the mock started. */
export function demoNow(): Date {
  return new Date(new Date(fx.DEMO_NOW).getTime() + (Date.now() - mockConfig.startedAt));
}

/** ISO string with the ET offset (-04:00 on the demo date). */
export function toEtIso(d: Date): string {
  const shifted = new Date(d.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 19);
  return `${shifted}-04:00`;
}

export function nextId(prefix: string): string {
  db.seq += 1;
  return `${prefix}_demo_${db.seq}`;
}
