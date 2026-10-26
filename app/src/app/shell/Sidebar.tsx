import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStatus } from '@/api';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useUiStore } from '../uiStore';
import { Logo } from './Logo';
import { NAV_MAIN, NAV_SECONDARY, type NavItem } from './nav';

function NavEntry({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useTranslation('shell');
  const label = t(`nav.${item.key}`);
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors focus-ring',
          isActive
            ? 'bg-surface2 text-text'
            : 'text-text-muted hover:bg-surface2/60 hover:text-text',
          collapsed && 'justify-center px-0',
        )
      }
      aria-label={collapsed ? label : undefined}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden
              className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-primary"
            />
          )}
          <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          {!collapsed && <span className="flex-1 truncate">{label}</span>}
          {!collapsed && item.badge && (
            <span className="rounded border border-border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              {item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
  return collapsed ? (
    <SimpleTooltip side="right" label={item.badge ? `${label} (${item.badge})` : label}>
      {link}
    </SimpleTooltip>
  ) : (
    link
  );
}

export function Sidebar() {
  const { t } = useTranslation('shell');
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const { data: status } = useStatus();
  const paper = status?.paper ?? true;
  const tier = status?.tier ?? 'free';

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200',
        collapsed ? 'w-[60px]' : 'w-[220px]',
      )}
      aria-label={t('sidebar.label')}
    >
      <div
        className={cn(
          'flex h-12 items-center gap-2 border-b border-border px-3',
          collapsed && 'justify-center px-0',
        )}
      >
        <Logo className="h-6 w-6 shrink-0" />
        {!collapsed && (
          <span className="text-[15px] font-semibold tracking-tight text-text">Levelset</span>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2" aria-label={t('sidebar.nav')}>
        {NAV_MAIN.map((item) => (
          <NavEntry key={item.key} item={item} collapsed={collapsed} />
        ))}
        <div className="my-2 border-t border-border" role="separator" />
        {NAV_SECONDARY.map((item) => (
          <NavEntry key={item.key} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <div className="border-t border-border p-2">
        {!collapsed ? (
          <div className="mb-2 flex items-center gap-2 px-1.5 text-xs">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-semibold uppercase tracking-wide',
                paper ? 'border-info/50 text-text' : 'border-warning/60 text-text',
              )}
            >
              <span
                aria-hidden
                className={cn('h-1.5 w-1.5 rounded-full', paper ? 'bg-info' : 'bg-warning')}
              />
              {paper ? t('footer.paper') : t('footer.live')}
            </span>
            <span className="text-text-muted">
              {t('footer.tier', { tier: t(`tiers.${tier}`) })}
            </span>
          </div>
        ) : (
          <SimpleTooltip
            side="right"
            label={`${paper ? t('footer.paper') : t('footer.live')} · ${t(`tiers.${tier}`)}`}
          >
            <div className="mb-2 flex justify-center">
              <span
                aria-hidden
                className={cn('h-2 w-2 rounded-full', paper ? 'bg-info' : 'bg-warning')}
              />
              <span className="sr-only">{paper ? t('footer.paper') : t('footer.live')}</span>
            </div>
          </SimpleTooltip>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs text-text-muted hover:bg-surface2 hover:text-text focus-ring',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          )}
          {!collapsed && <span>{t('sidebar.collapse')}</span>}
        </button>
      </div>
    </aside>
  );
}
