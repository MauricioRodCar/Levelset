import { Toaster as Sonner, toast } from 'sonner';
import { useActiveTheme } from '@/theme';

/** App-wide toast host (sonner), styled with theme tokens. Use `toast(...)` from this module. */
export function Toaster() {
  const theme = useActiveTheme();
  return (
    <Sonner
      theme={theme.mode}
      position="bottom-right"
      duration={2200}
      toastOptions={{
        classNames: {
          toast: 'bg-surface2 text-text border border-border shadow-lg',
          description: 'text-text-muted',
        },
      }}
    />
  );
}

export { toast };
