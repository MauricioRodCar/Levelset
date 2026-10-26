/**
 * Pipeline view model: step metadata, status mapping, and safe readers for the raw skill JSON the
 * engine puts in Step.outputs (see engine/levelset_engine/pipeline/steps.py for the shapes).
 */
import {
  CalendarClock,
  ClipboardCheck,
  Crosshair,
  Newspaper,
  Radar,
  ShieldCheck,
  Ticket as TicketIcon,
  Wallet,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import type { BadgeStatus } from '@/components/StatusBadge';
import type { PipelineRun, PipelineRunSummary, Step, StepKey } from '@/api';
import { STEP_KEYS } from '@/api';

export const STEP_ICONS: Record<StepKey, LucideIcon> = {
  scanner: Radar,
  news: Newspaper,
  entry: Crosshair,
  exit: LogOut,
  timemachine: CalendarClock,
  budget: Wallet,
  risk: ShieldCheck,
  ticket: TicketIcon,
};
export const CHECKLIST_ICON = ClipboardCheck;

export const FINISHED = ['done', 'check', 'blocked', 'error'] as const;
export const isFinished = (s: Step | undefined) =>
  !!s && (FINISHED as readonly string[]).includes(s.status);
/** The engine lets a step run when every earlier step is done or check (ticket also after a risk BLOCK). */
export const isReadyBefore = (s: Step) => s.status === 'done' || s.status === 'check';

/** Status badge for a step card. A finished ticket step reads "Ready" (UI mapping of `done`). */
export function badgeFor(step: Step): BadgeStatus {
  if (step.key === 'ticket' && step.status === 'done') return 'ready';
  return step.status;
}

export function runBadge(run: Pick<PipelineRunSummary, 'status'>): BadgeStatus {
  return run.status;
}

export function stepIndex(key: StepKey) {
  return STEP_KEYS.indexOf(key);
}

export function orderedSteps(run: PipelineRun): Step[] {
  return STEP_KEYS.map(
    (key) =>
      run.steps.find((s) => s.key === key) ?? {
        key,
        status: 'pending',
      },
  );
}

/**
 * Where a run stopped: a finished run-all with pending steps left (e.g. entry still waiting),
 * or a blocked / error step. Returns the step that stopped it.
 */
export function stoppedAt(run: PipelineRun): Step | null {
  if (run.status === 'running') return null;
  const steps = orderedSteps(run);
  const lastDone = [...steps].reverse().find((s) => s.status !== 'pending');
  if (!lastDone) return null;
  const idx = stepIndex(lastDone.key);
  const pendingAfter = steps.slice(idx + 1).some((s) => s.status === 'pending');
  if (!pendingAfter) return null;
  if (lastDone.status === 'done') return null; // simply the next step to run (step mode)
  return lastDone;
}

/** The step to show first: running, else where it stopped, else the ticket, else the next pending. */
export function defaultSelection(run: PipelineRun): StepKey {
  const steps = orderedSteps(run);
  const running = steps.find((s) => s.status === 'running');
  if (running) return running.key;
  const stop = stoppedAt(run);
  if (stop) return stop.key;
  if (steps.every((s) => s.status === 'pending')) return 'scanner';
  const next = steps.find((s) => s.status === 'pending');
  if (next && run.mode === 'step') return next.key;
  const lastFinished = [...steps].reverse().find((s) => s.status !== 'pending');
  return lastFinished?.key ?? 'scanner';
}

// ---------------------------------------------------------------- raw JSON readers

export type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
export const arr = <T = Obj>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
export const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null;

export const values = (step: Step | undefined): Obj => obj(step?.summary?.values);

/** "10:15 AM" (skill style, New York) -> "10:15". Leaves "10:15" alone. */
export function clock24(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (!m) return s;
  let h = Number(m[1]);
  if (m[3]) {
    const pm = m[3].toUpperCase() === 'PM';
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** "max loss" -> "max_loss" (budget limit names). */
export const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** Problem detail "scanner is pending" -> { step: 'scanner', status: 'pending' }. */
export function parsePrevDetail(detail?: string): { step: StepKey; status: string } | null {
  const m = detail?.match(/^(\w+) is (\w+)$/);
  if (!m || !(STEP_KEYS as readonly string[]).includes(m[1])) return null;
  return { step: m[1] as StepKey, status: m[2] };
}

/** ET date (YYYY-MM-DD) of an ISO timestamp or Unix seconds. */
export function etDay(v: string | number): string {
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** The step before / after `key` (clamped to the first / last). */
export const nextKey = (key: StepKey, dir: 1 | -1): StepKey =>
  STEP_KEYS[Math.min(STEP_KEYS.length - 1, Math.max(0, stepIndex(key) + dir))];
