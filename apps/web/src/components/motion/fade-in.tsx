'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

type FadeInProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'none';
  distance?: number;
  once?: boolean;
};

const directionMap = {
  up: { y: 1 },
  down: { y: -1 },
  left: { x: 1 },
  right: { x: -1 },
  none: {},
} as const;

export function FadeIn({
  children,
  className,
  delay = 0,
  duration = 0.4,
  direction = 'up',
  distance = 24,
  once = true,
}: FadeInProps) {
  const dir = directionMap[direction];
  const initial = {
    opacity: 0,
    ...('y' in dir ? { y: dir.y * distance } : {}),
    ...('x' in dir ? { x: dir.x * distance } : {}),
  };

  return (
    <motion.div
      className={className}
      initial={initial}
      whileInView={{ opacity: 1, y: 0, x: 0 }}
      viewport={{ once }}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1], // ease-out (Emil Kowalski's go-to)
      }}
    >
      {children}
    </motion.div>
  );
}
