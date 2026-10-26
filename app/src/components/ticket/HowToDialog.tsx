import { useTranslation } from 'react-i18next';
import type { Ticket } from '@/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InstrumentNote } from './InstrumentNote';
import { PlatformHowTo } from './PlatformHowTo';
import { HOWTO_PLATFORMS } from './platforms';

export interface HowToDialogProps {
  ticket: Ticket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** "How to enter this in cTrader / MT4 / MT5": the ticket's values plus per-platform steps. */
export function HowToDialog({ ticket, open, onOpenChange }: HowToDialogProps) {
  const { t } = useTranslation('tickets');
  const { t: tc } = useTranslation('connections');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('howto.title', { symbol: ticket.symbol })}</DialogTitle>
          <DialogDescription>{t('howto.description')}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={HOWTO_PLATFORMS[0]}>
          <TabsList className="mb-3 flex-wrap">
            {HOWTO_PLATFORMS.map((p) => (
              <TabsTrigger key={p} value={p}>
                {tc(`platforms.${p}.name`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {HOWTO_PLATFORMS.map((p) => (
            <TabsContent key={p} value={p}>
              <PlatformHowTo platform={p} ticket={ticket} />
            </TabsContent>
          ))}
        </Tabs>
        <InstrumentNote className="mt-4" />
      </DialogContent>
    </Dialog>
  );
}
