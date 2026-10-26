import {
  Bell,
  Landmark,
  LayoutDashboard,
  LineChart,
  Plug,
  Settings,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  /** i18n key under shell:nav.* */
  key: 'dashboard' | 'pipeline' | 'alerts' | 'analyst' | 'pelosi' | 'connections' | 'settings';
  to: string;
  icon: LucideIcon;
  /** Shows a version badge (feature not in v1.0). */
  badge?: string;
  end?: boolean;
}

export const NAV_MAIN: NavItem[] = [
  { key: 'dashboard', to: '/', icon: LayoutDashboard, end: true },
  { key: 'pipeline', to: '/pipeline', icon: Workflow },
  { key: 'alerts', to: '/alerts', icon: Bell },
  { key: 'analyst', to: '/analyst', icon: LineChart, badge: 'v1.1' },
  { key: 'pelosi', to: '/pelosi', icon: Landmark, badge: 'v1.1' },
];

export const NAV_SECONDARY: NavItem[] = [
  { key: 'connections', to: '/connections', icon: Plug },
  { key: 'settings', to: '/settings', icon: Settings },
];
