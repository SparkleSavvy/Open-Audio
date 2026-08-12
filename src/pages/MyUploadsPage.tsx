import { Link } from 'react-router';
import { Upload } from 'lucide-react';
import MyTracksList from '../components/MyTracksList';

export default function MyUploadsPage() {
  return (
    <div>
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100">My uploads</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Tracks you submitted. Verified ones appear in the public feed.
          </p>
        </div>
        <Link
          to="/upload"
          className="inline-flex items-center gap-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 px-4 py-2 rounded-full transition-colors"
        >
          <Upload className="w-4 h-4" /> New track
        </Link>
      </div>

      <MyTracksList />
    </div>
  );
}
