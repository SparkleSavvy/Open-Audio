import { AlertTriangle, Check, Clock, X } from 'lucide-react';
import type { TrackStatus } from '../types';

const CONFIG: Record<TrackStatus, { icon: typeof Check; label: string; className: string }> = {
  pending: { icon: Clock, label: 'Pending review', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  verified: { icon: Check, label: 'Verified', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  approved: { icon: Check, label: 'Approved', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  suspended: { icon: AlertTriangle, label: 'Suspended', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  rejected: { icon: X, label: 'Rejected', className: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

export default function StatusBadge({ status, className = '' }: { status: TrackStatus; className?: string }) {
  const { icon: Icon, label, className: tone } = CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${tone} ${className}`}
    >
      <Icon className="w-3 h-3" strokeWidth={2.5} />
      {label}
    </span>
  );
}
