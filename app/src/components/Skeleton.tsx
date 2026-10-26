import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** Loading placeholder block. Size it with className (h-4 w-24 ...). */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden className={cn('animate-pulse rounded-md bg-surface2', className)} {...props} />
  );
}
