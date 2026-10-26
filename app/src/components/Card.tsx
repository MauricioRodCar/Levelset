import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  /** Small text under the title. */
  subtitle?: ReactNode;
  /** Right-aligned header content (buttons, badges). */
  actions?: ReactNode;
  /** Remove inner padding (for tables / lists that manage their own). */
  flush?: boolean;
  as?: 'section' | 'div' | 'article';
}

/** Surface container used by every panel. */
export function Card({
  title,
  subtitle,
  actions,
  flush,
  as: Tag = 'section',
  className,
  children,
  ...rest
}: CardProps) {
  const hasHeader = title || actions || subtitle;
  return (
    <Tag
      className={cn('rounded-lg border border-border bg-surface text-text', className)}
      {...rest}
    >
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0">
            {title && <h2 className="truncate text-sm font-semibold text-text">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && 'px-4 pb-4', !flush && !hasHeader && 'pt-4')}>{children}</div>
    </Tag>
  );
}
