import { Check, AlertTriangle } from 'lucide-react';
import type { TrackStatus } from '../types';

interface TrackMarkProps {
  status: TrackStatus;
  className?: string;
}

export default function TrackMark({ status, className = '' }: TrackMarkProps) {
  if (status === 'verified' || status === 'approved') {
    return (
      <span
        title="Verified"
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-neutral-100 shrink-0 ${className}`}
      >
        <Check className="w-2.5 h-2.5 text-neutral-950" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === 'suspended') {
    return (
      <span
        title="Suspended"
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/25 shrink-0 ${className}`}
      >
        <AlertTriangle className="w-3 h-3 text-amber-400" strokeWidth={2.5} />
      </span>
    );
  }
  return null;
}
