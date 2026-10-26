import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from './PageHeader';

/** Page for features planned in a later version (Analyst, Pelosi). */
export function ComingSoon({
  icon: Icon,
  title,
  description,
  version,
  bullets,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  version: string;
  bullets: string[];
}) {
  const { t } = useTranslation('shell');
  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            {title}
            <span className="rounded border border-border px-1.5 py-px text-xs font-semibold uppercase tracking-wide text-text-muted">
              {version}
            </span>
          </span>
        }
        description={description}
      />
      <div className="flex max-w-2xl gap-4 rounded-lg border border-border bg-surface p-6">
        <Icon className="h-8 w-8 shrink-0 text-accent" aria-hidden />
        <div>
          <p className="font-medium text-text">{t('comingSoon.title', { version })}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-muted">
            {bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
