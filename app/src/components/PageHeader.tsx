import type { ReactNode } from 'react';
import { Construction } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h1 className="text-xl font-semibold text-text">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Simple "being built" body for pages another work package will fill in. */
export function PlaceholderPage({
  title,
  description,
  note,
}: {
  title: ReactNode;
  description: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-5 py-6 text-sm text-text-muted">
        <Construction className="h-5 w-5 shrink-0" aria-hidden />
        <span>{note}</span>
      </div>
    </div>
  );
}
