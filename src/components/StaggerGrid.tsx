import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';

export const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

export const staggerItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function StaggerGrid({
  children,
  className,
  animateIn = true,
}: {
  children: ReactNode;
  className?: string;
  animateIn?: boolean;
}) {
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div className={className} variants={staggerContainer} initial={animateIn ? 'hidden' : false} animate="show">
      {children}
    </motion.div>
  );
}
