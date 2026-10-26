import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TicketMenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
}

/** Small accessible overflow menu ("⋯") for secondary ticket actions. */
export function TicketMenu({ items, label }: { items: TicketMenuItem[]; label?: string }) {
  const { t } = useTranslation('tickets');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        size="sm"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label ?? t('menu.more')}
        onClick={() => setOpen((v) => !v)}
        className="text-text-muted hover:text-text"
      >
        <MoreHorizontal aria-hidden />
      </Button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label ?? t('menu.more')}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-40 mt-1 w-max min-w-56 rounded-md border border-border bg-surface2 p-1 shadow-lg"
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close();
                it.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2 whitespace-nowrap rounded px-2.5 py-1.5 text-left text-sm text-text',
                'hover:bg-surface focus:bg-surface focus:outline-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-muted',
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
