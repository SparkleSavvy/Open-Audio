import { Link } from 'react-router';
import { Compass } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="py-24 flex flex-col items-center gap-4 text-center">
      <Compass className="w-12 h-12 text-neutral-700" />
      <h1 className="text-3xl font-bold tracking-tight text-neutral-100">404</h1>
      <p className="text-sm text-neutral-500">This page drifted out of the mix.</p>
      <Link to="/" className="text-sm font-medium text-neutral-100 hover:underline mt-2">
        Back to feed
      </Link>
    </div>
  );
}
