import { Heart } from 'lucide-react';

export default function SupporterBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide bg-neutral-900 border-neutral-800 text-neutral-300"
      title="Supporter — can download lossless (FLAC) tracks"
    >
      <Heart className="w-3 h-3" strokeWidth={2.5} />
      Supporter
    </span>
  );
}
