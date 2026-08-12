import { AlertTriangle, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePlayer } from '../lib/PlayerContext';

export default function Toast() {
  const { notice } = usePlayer();

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[60] pointer-events-none">
      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice.id}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={`flex items-center gap-2.5 rounded-full border bg-neutral-900/95 backdrop-blur px-4 py-2.5 shadow-2xl ${
              notice.variant === 'success'
                ? 'border-emerald-500/40'
                : 'border-amber-500/30'
            }`}
          >
            {notice.variant === 'success' ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" strokeWidth={2.5} />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span className="text-sm font-medium text-neutral-100">{notice.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
