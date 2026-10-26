import { Info, MonitorSmartphone, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { usePaperSettings } from '@/api';
import { Card } from '@/components/Card';
import { useFormat } from '@/i18n/useFormat';

/** PRD §3 P5: what the paper numbers can and cannot tell you, stated plainly. */
export function ConstraintNotes() {
  const { t } = useTranslation('paper');
  const f = useFormat();
  const s = usePaperSettings().data;
  const pct = f.percent(s?.slippagePct ?? 0.02, { fractionDigits: 2 });
  const perShare = f.money(s?.slippagePerShare ?? 0.01);
  return (
    <Card title={t('notes.title')} data-testid="paper-notes">
      <ul className="space-y-2 text-xs text-text-muted">
        <li className="flex gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <span>{t('notes.fills', { pct, perShare })}</span>
        </li>
        <li className="flex gap-2">
          <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>{t('notes.awake')}</span>
        </li>
        <li className="flex gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <span>{t('notes.catchup')}</span>
        </li>
        <li className="flex gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
          <span>{t('notes.separate')}</span>
        </li>
      </ul>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <Link
          to="/settings/paper"
          className="inline-flex items-center gap-1 text-accent hover:underline focus-ring"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden />
          {t('notes.settings')}
        </Link>
        <Link
          to="/settings/system"
          className="inline-flex items-center gap-1 text-accent hover:underline focus-ring"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden />
          {t('notes.system')}
        </Link>
      </div>
    </Card>
  );
}
