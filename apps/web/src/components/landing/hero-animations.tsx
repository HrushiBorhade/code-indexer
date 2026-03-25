'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

const ease = [0.16, 1, 0.3, 1] as const;

export function HeroBadge({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease }}
    >
      {children}
    </motion.div>
  );
}

export function HeroTitle({ children }: { children: ReactNode }) {
  return (
    <motion.h1
      className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.1, ease }}
    >
      {children}
    </motion.h1>
  );
}

export function HeroDescription({ children }: { children: ReactNode }) {
  return (
    <motion.p
      className="mt-4 max-w-lg text-sm text-muted-foreground"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.2, ease }}
    >
      {children}
    </motion.p>
  );
}

export function HeroActions({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="mt-6 flex items-center gap-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.3, ease }}
    >
      {children}
    </motion.div>
  );
}

export function HeroTerminal({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="mt-16 w-full max-w-2xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.4, ease }}
    >
      {children}
    </motion.div>
  );
}

export function FeatureCard({ children, index }: { children: ReactNode; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.1, ease }}
    >
      {children}
    </motion.div>
  );
}
