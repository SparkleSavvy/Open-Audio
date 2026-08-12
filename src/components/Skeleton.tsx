import { motion } from 'motion/react';
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion';

interface SkeletonProps {
  key?: string | number;
  className?: string;
}

export default function Skeleton({ className }: SkeletonProps) {
  const reduced = usePrefersReducedMotion();

  return (
    <div className={`relative overflow-hidden bg-neutral-900 ${className ?? ''}`}>
      {!reduced && (
        <motion.div
          className="absolute inset-0 bg-neutral-800/60"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </div>
  );
}
