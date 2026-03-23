'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

const ease = [0.16, 1, 0.3, 1] as const; // Emil Kowalski's ease-out

export function HeroBadge({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1, ease }}
    >
      {children}
    </motion.h1>
  );
}

export function HeroDescription({ children }: { children: ReactNode }) {
  return (
    <motion.p
      className="mt-4 max-w-lg text-base text-muted-foreground sm:text-lg"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease }}
    >
      {children}
    </motion.p>
  );
}

export function HeroActions({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="mt-8 flex items-center gap-3"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
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
      initial={{ opacity: 0, y: 30, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.6, delay: 0.4, ease }}
    >
      {children}
    </motion.div>
  );
}

export function FeatureCard({ children, index }: { children: ReactNode; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.1, ease }}
      whileHover={{ y: -2 }}
    >
      {children}
    </motion.div>
  );
}
