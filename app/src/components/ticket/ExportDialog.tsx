import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTicketExport, type Ticket, type TicketExportFormat } from '@/api';
import { ErrorState } from '@/components/ErrorState';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSaveFile } from '@/components/useSaveFile';
import { cn } from '@/lib/utils';
import { EXPORT_FORMATS, exportFileName } from './exportFile';
import { useCopyText } from './useCopyPrice';

export interface ExportDialogProps {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFormat?: TicketExportFormat;
}

/** Export a ticket as text / CSV / JSON / cTrader / MT4 / MT5: preview, copy or save. */
export function ExportDialog({
  ticket,
  open,
  onOpenChange,
  initialFormat = 'text',
}: ExportDialogProps) {
  const { t } = useTranslation('tickets');
  const [format, setFormat] = useState<TicketExportFormat>(initialFormat);
  const q = useTicketExport(ticket.id, format, { enabled: open });
  const copy = useCopyText();
  const saveFile = useSaveFile();
  const fileName = exportFileName(ticket, format);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('export.title', { symbol: ticket.symbol })}</DialogTitle>
          <DialogDescription>{t('export.description')}</DialogDescription>
        </DialogHeader>
        <div
          role="radiogroup"
          aria-label={t('export.format')}
          className="mb-3 flex flex-wrap gap-1.5"
        >
          {EXPORT_FORMATS.map((fmt) => (
            <button
              key={fmt}
              type="button"
              role="radio"
              aria-checked={format === fmt}
              onClick={() => setFormat(fmt)}
              className={cn(
                'h-8 rounded-md border px-3 text-sm focus-ring',
                format === fmt
                  ? 'border-accent bg-accent/10 font-medium text-text'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              {t(`export.formats.${fmt}`)}
            </button>
          ))}
        </div>
        {q.isError ? (
          <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isLoading || q.data === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <pre
            className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-3 font-mono text-xs text-text"
            data-testid="export-preview"
          >
            {q.data}
          </pre>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={q.data === undefined}
            onClick={() => {
              if (q.data === undefined) return;
              void saveFile(fileName, q.data, t(`export.formats.${format}`));
            }}
          >
            <Download aria-hidden />
            {t('export.save')}
          </Button>
          <Button
            variant="primary"
            disabled={q.data === undefined}
            onClick={() => q.data !== undefined && void copy(q.data, t(`export.formats.${format}`))}
          >
            <Copy aria-hidden />
            {t('export.copy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
