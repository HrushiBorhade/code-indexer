'use client';

import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ReactNode } from 'react';
import { useSessionSync } from '@/hooks/use-session-sync';

function SessionSync() {
  useSessionSync();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <SessionSync />
        {children}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
