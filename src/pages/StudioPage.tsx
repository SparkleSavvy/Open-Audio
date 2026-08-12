import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { UploadCloud, CloudDownload, Library, Loader2, CheckCircle2, ExternalLink, Music2 } from 'lucide-react';
import { motion } from 'motion/react';
import UploadForm from '../components/UploadForm';
import MyTracksList from '../components/MyTracksList';
import { api, ApiError } from '../lib/api';
import type { Track } from '../types';

type StudioTab = 'upload' | 'import' | 'mytracks';

const TABS: { id: StudioTab; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'import', label: 'Import from SoundCloud' },
  { id: 'mytracks', label: 'My tracks' },
];

function ImportTool() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Track | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { track } = await api.importSoundCloud(url.trim());
      setDone(track);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-lg mx-auto rounded-xl border border-neutral-800 bg-neutral-900/50 p-10 text-center"
      >
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-neutral-100">Track imported</h2>
        <p className="text-sm text-neutral-400 mt-2">
          “{done.title}” by {done.artist} was imported from SoundCloud and sent to moderation. It will appear in
          the feed once verified.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            to={`/track/${done.id}`}
            className="text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 px-4 py-2 rounded-full transition-colors"
          >
            View track
          </Link>
          <Link to="/" className="text-sm font-medium text-neutral-400 hover:text-neutral-100 px-4 py-2 transition-colors">
            Back to feed
          </Link>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
      <div className="px-6 py-5 border-b border-neutral-800">
        <h2 className="text-lg font-semibold text-neutral-100">Import from SoundCloud</h2>
        <p className="text-sm text-neutral-500 mt-1">
          Paste a SoundCloud track link and it will be downloaded with yt-dlp, keeping the original M4A quality —
          no re-encoding. The track goes to moderation before publishing.
        </p>
      </div>
      <div className="p-6 flex flex-col gap-5">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="block text-xs font-medium text-neutral-400">SoundCloud track URL</label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="https://soundcloud.com/artist/track"
              disabled={busy}
              className="flex-1 min-w-0 px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-900 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="inline-flex items-center justify-center gap-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed px-6 py-2.5 rounded-full transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </form>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-sm text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-2.5"
          >
            {error}
          </motion.div>
        )}

        <div className="text-xs text-neutral-600 space-y-1.5">
          <p>
            <span className="font-medium text-neutral-500">Limits:</span> single tracks only (no playlists or sets),
            up to 60 MB.
          </p>
          <p className="flex items-center gap-1.5">
            <Music2 className="w-3.5 h-3.5" /> The file is stored as-is in M4A — original quality is preserved.
          </p>
          <p className="flex items-center gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> Imported tracks are marked on the site with a SoundCloud badge.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function StudioPage() {
  const [tab, setTab] = useState<StudioTab>('upload');

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Studio</h1>
        <p className="text-sm text-neutral-400 mt-1">
          All tools for getting music onto the platform — upload your own files or import a track from SoundCloud.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border transition-colors press ${
              tab === t.id
                ? 'bg-neutral-100 text-neutral-950 border-transparent'
                : 'border-neutral-800 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600'
            }`}
          >
            {t.id === 'upload' ? (
              <UploadCloud className="w-4 h-4" />
            ) : t.id === 'import' ? (
              <CloudDownload className="w-4 h-4" />
            ) : (
              <Library className="w-4 h-4" />
            )}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'upload' && <UploadForm />}
      {tab === 'import' && <ImportTool />}
      {tab === 'mytracks' && <MyTracksList onNewTrack={() => setTab('upload')} />}
    </div>
  );
}
