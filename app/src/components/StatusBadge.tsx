import {
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Loader2,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  XOctagon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export type BadgeStatus =
  | 'done'
  | 'check'
  | 'ready'
  | 'blocked'
  | 'error'
  | 'running'
  | 'pending'
  | 'pass'
  | 'block'
  | 'stale';

const MAP: Record<BadgeStatus, { icon: LucideIcon; tone: string; spin?: boolean }> = {
  done: { icon: CheckCircle2, tone: 'text-profit border-profit/40 bg-profit/10' },
  pass: { icon: ShieldCheck, tone: 'text-profit border-profit/40 bg-profit/10' },
  ready: { icon: CircleDot, tone: 'text-primary border-primary/40 bg-primary/10' },
  check: { icon: TriangleAlert, tone: 'text-warning border-warning/40 bg-warning/10' },
  blocked: { icon: Ban, tone: 'text-loss border-loss/40 bg-loss/10' },
  block: { icon: ShieldX, tone: 'text-loss border-loss/40 bg-loss/10' },
  error: { icon: XOctagon, tone: 'text-loss border-loss/40 bg-loss/10' },
  running: { icon: Loader2, tone: 'text-info border-info/40 bg-info/10', spin: true },
  pending: { icon: CircleDashed, tone: 'text-text-muted border-border bg-transparent' },
  stale: { icon: CircleDashed, tone: 'text-text-muted border-border bg-surface2' },
};

export interface StatusBadgeProps {
  status: BadgeStatus;
  /** Override the default translated label. */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Status pill: icon + text label, never colour alone.
 * The icon and border carry the status colour; the label stays in --ls-text for contrast.
 */
export function StatusBadge({ status, label, size = 'md', className }: StatusBadgeProps) {
  const { t } = useTranslation('common');
  const { icon: Icon, tone, spin } = MAP[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        tone,
        className,
      )}
      data-status={status}
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', spin && 'animate-spin')} aria-hidden />
      <span className="text-text">{label ?? t(`status.${status}`)}</span>
    </span>
  );
}
