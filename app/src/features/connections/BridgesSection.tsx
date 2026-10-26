import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  ChevronDown,
  CircleDashed,
  CircleDot,
  FolderOpen,
  Info,
  ShieldCheck,
  WifiOff,
  XOctagon,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  BRIDGE_PLATFORMS,
  useBridgeSettings,
  useBridgeStatus,
  useUpdateBridgeSettings,
  type BridgePlatform,
  type BridgeStatus,
} from '@/api';
import { Card } from '@/components/Card';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import { Input, Label, Switch } from '@/components/ui/form';
import { toast } from '@/components/ui/toaster';
import { useFormat } from '@/i18n/useFormat';
import { cn } from '@/lib/utils';
import { BRIDGE_FILES, isAbsolutePath, useBridgeErrorMessage } from './bridgeUi';
import { SymbolMapEditor } from './SymbolMapEditor';

/**
 * Connections > In-platform bridges (v1.1, PRD §6): signals folder, heartbeat status per platform,
 * install guide per platform and the symbol-mapping editor. Levelset only writes signal files;
 * the user places every order with the Place button inside cTrader / MetaTrader.
 */
export function BridgesSection() {
  const { t } = useTranslation('connections');
  return (
    <section aria-labelledby="bridges-title" className="mb-6 space-y-4" data-testid="bridges">
      <div>
        <h2 id="bridges-title" className="text-lg font-semibold text-text">
          {t('bridges.title')}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{t('bridges.intro')}</p>
      </div>
      <FolderSetting />
      <StatusList />
      <SymbolMapEditor />
    </section>
  );
}

function FolderSetting() {
  const { t } = useTranslation('connections');
  const settings = useBridgeSettings();
  const update = useUpdateBridgeSettings();
  const errorMessage = useBridgeErrorMessage();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const current = settings.data?.signalsFolder ?? '';

  useEffect(() => setValue(current), [current]);

  if (settings.isError) return <ErrorState error={settings.error} onRetry={settings.refetch} />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isAbsolutePath(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    update.mutate(
      { signalsFolder: value.trim() },
      {
        onSuccess: () => toast(t('bridges.folder.saved')),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-2 p-4">
        <Label htmlFor={inputId} className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-text-muted" aria-hidden />
          {t('bridges.folder.label')}
        </Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={inputId}
            value={value}
            disabled={settings.isPending}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={hintId}
            spellCheck={false}
            className="min-w-0 flex-1 font-mono text-xs"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={settings.isPending || update.isPending || value.trim() === current}
          >
            {t('bridges.folder.save')}
          </Button>
        </div>
        {invalid && (
          <p role="alert" className="text-xs text-text">
            {t('bridges.folder.invalid')}
          </p>
        )}
        <p id={hintId} className="flex items-start gap-1.5 text-xs text-text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('bridges.folder.hint')}
        </p>
      </form>
    </Card>
  );
}

const STATE_UI: Record<BridgeStatus['state'], { icon: LucideIcon; tone: string }> = {
  online: { icon: CircleDot, tone: 'text-profit border-profit/40 bg-profit/10' },
  offline: { icon: WifiOff, tone: 'text-warning border-warning/40 bg-warning/10' },
  not_installed: { icon: CircleDashed, tone: 'text-text-muted border-border bg-transparent' },
  error: { icon: XOctagon, tone: 'text-loss border-loss/40 bg-loss/10' },
};

/** Heartbeat state pill: icon + label (never colour alone); the label stays in --ls-text. */
export function BridgeStateBadge({ state }: { state: BridgeStatus['state'] }) {
  const { t } = useTranslation('connections');
  const { icon: Icon, tone } = STATE_UI[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        tone,
      )}
      data-state={state}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="text-text">{t(`bridges.status.states.${state}`)}</span>
    </span>
  );
}

function StatusList() {
  const { t } = useTranslation('connections');
  const status = useBridgeStatus();
  const settings = useBridgeSettings();
  if (status.isError) return <ErrorState error={status.error} onRetry={status.refetch} />;
  const rows = status.data;
  return (
    <Card title={t('bridges.status.title')} flush>
      {!rows || !settings.data ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {BRIDGE_PLATFORMS.map((p) => {
            const row = rows.find((r) => r.platform === p);
            return row ? (
              <PlatformStatusRow key={p} row={row} enabled={settings.data.platforms[p].enabled} />
            ) : null;
          })}
        </ul>
      )}
    </Card>
  );
}

function PlatformStatusRow({ row, enabled }: { row: BridgeStatus; enabled: boolean }) {
  const { t } = useTranslation('connections');
  const f = useFormat();
  const update = useUpdateBridgeSettings();
  const errorMessage = useBridgeErrorMessage();
  const [open, setOpen] = useState(false);
  const p = row.platform;
  const name = t(`platforms.${p}.name`);
  const stepsId = `bridge-install-${p}`;

  const toggle = (on: boolean) =>
    update.mutate(
      { platforms: { [p]: { enabled: on } } as Record<BridgePlatform, { enabled: boolean }> },
      { onError: (err) => toast.error(errorMessage(err)) },
    );

  const details = [
    row.lastHeartbeatAt
      ? t('bridges.status.lastHeartbeat', { time: f.marketDateTime(row.lastHeartbeatAt) })
      : t('bridges.status.never'),
    row.accountIsDemo == null
      ? null
      : row.accountIsDemo
        ? t('bridges.status.demo')
        : t('bridges.status.live'),
    row.bridgeVersion ? t('bridges.status.version', { version: row.bridgeVersion }) : null,
  ].filter(Boolean);

  return (
    <li className="px-4 py-3" data-testid={`bridge-status-${p}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          disabled={update.isPending}
          aria-label={t('bridges.status.enable', { platform: name })}
        />
        <span className="text-sm font-medium text-text">{name}</span>
        <BridgeStateBadge state={row.state} />
        <span className="tabular text-xs text-text-muted">{details.join(' · ')}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={stepsId}
          onClick={() => setOpen((v) => !v)}
          className="ml-auto flex items-center gap-1 rounded text-sm text-accent hover:underline focus-ring"
        >
          {open ? t('bridges.install.hide') : t('bridges.install.show')}
          <ChevronDown
            className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      </div>
      {row.error && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-text">
          <XOctagon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-loss" aria-hidden />
          {row.error}
        </p>
      )}
      {!!row.missingSymbols?.length && (
        <p className="mt-1 text-xs text-text-muted">
          {t('bridges.status.missing', { symbols: row.missingSymbols.join(', ') })}
        </p>
      )}
      <p className="mt-1 break-all font-mono text-xs text-text-muted">
        {t('bridges.status.folder', { folder: row.folder })}
      </p>
      {open && <InstallGuide platform={p} id={stepsId} />}
    </li>
  );
}

function InstallGuide({ platform, id }: { platform: BridgePlatform; id: string }) {
  const { t } = useTranslation('connections');
  const steps = t(`bridges.install.${platform}`, { returnObjects: true }) as string[];
  return (
    <div id={id} className="mt-3 rounded-md bg-surface2 px-4 py-3">
      <p className="mb-2 font-mono text-xs text-text-muted">
        {t('bridges.install.file', { file: BRIDGE_FILES[platform] })}
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-text">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p className="mt-3 flex items-start gap-1.5 text-xs text-text-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        {t('bridges.install.safety')}
      </p>
    </div>
  );
}
