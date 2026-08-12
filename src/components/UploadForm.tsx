import { useRef, useState, ChangeEvent, DragEvent } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { UploadCloud, Music2, ImagePlus, X, CheckCircle2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api, ApiError } from '../lib/api';
import { formatTime } from '../lib/format';
import type { Track } from '../types';

function FileZone({
  accept,
  title,
  hint,
  selected,
  onSelect,
  onClear,
  icon,
  preview,
  error,
}: {
  accept: string;
  title: string;
  hint: string;
  selected: File | null;
  onSelect: (f: File) => void;
  onClear: () => void;
  icon: ReactNode;
  preview?: string | null;
  error?: string | null;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onSelect(file);
  };

  if (selected) {
    return (
      <div className="relative rounded-lg border border-neutral-800 bg-neutral-900 overflow-hidden">
        {preview ? (
          <img src={preview} alt="" className="w-full h-36 object-cover" />
        ) : (
          <div className="h-36 flex flex-col items-center justify-center gap-2 text-neutral-300">
            {icon}
            <span className="text-sm font-medium">{selected.name}</span>
            <span className="text-xs text-neutral-500">{(selected.size / 1024 / 1024).toFixed(1)} MB</span>
          </div>
        )}
        <button
          onClick={onClear}
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-neutral-200 hover:bg-black/80 hover:text-white flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      className={`w-full rounded-lg border border-dashed transition-colors duration-200 ${
        drag
          ? 'border-neutral-400 bg-neutral-900'
          : error
            ? 'border-red-500/40 bg-red-500/5'
            : 'border-neutral-800 bg-neutral-900/40 hover:border-neutral-600 hover:bg-neutral-900'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0];
          if (f) onSelect(f);
          e.target.value = '';
        }}
      />
      <div className="h-36 flex flex-col items-center justify-center gap-2 text-neutral-400">
        {icon}
        <span className="text-sm font-medium text-neutral-300">{title}</span>
        <span className="text-xs text-neutral-500">{hint}</span>
      </div>
    </button>
  );
}

export default function UploadForm() {
  const [audio, setAudio] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('');
  const [license, setLicense] = useState('all rights reserved');
  const [duration, setDuration] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Track | null>(null);
  const probeRef = useRef<HTMLAudioElement>(null);

  const pickAudio = (f: File) => {
    setAudio(f);
    setError(null);
    const url = URL.createObjectURL(f);
    const audioEl = probeRef.current;
    if (!audioEl) return;
    audioEl.src = url;
    audioEl.load();
    const onMeta = () => {
      setDuration(audioEl.duration || 0);
      URL.revokeObjectURL(url);
      audioEl.removeEventListener('loadedmetadata', onMeta);
    };
    audioEl.addEventListener('loadedmetadata', onMeta);
  };

  const pickCover = (f: File) => {
    setCover(f);
    setError(null);
    const url = URL.createObjectURL(f);
    setCoverPreview(url);
  };

  const clearCover = () => {
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCover(null);
    setCoverPreview(null);
  };

  const buildFormData = (): FormData | null => {
    if (!audio) {
      setError('Select an audio file first');
      return null;
    }
    const form = new FormData();
    form.append('audio', audio);
    if (cover) form.append('cover', cover);
    if (title.trim()) form.append('title', title);
    if (artist.trim()) form.append('artist', artist);
    form.append('description', description);
    if (genre.trim()) form.append('genre', genre);
    form.append('license', license);
    if (duration > 0) form.append('duration', String(Math.round(duration)));
    return form;
  };

  const submit = async () => {
    const form = buildFormData();
    if (!form) return;
    setSubmitting(true);
    setError(null);
    try {
      const { track } = await api.uploadTrack(form);
      setUploaded(track);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (uploaded) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-lg mx-auto rounded-xl border border-neutral-800 bg-neutral-900/50 p-10 text-center"
      >
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-neutral-100">Track submitted</h2>
        <p className="text-sm text-neutral-400 mt-2">
          “{uploaded.title}” by {uploaded.artist} was sent to moderation. It will appear in the feed once
          verified.
        </p>
        <p className="text-xs text-neutral-500 mt-1">
          Title, artist, duration and cover were filled automatically from the file metadata where possible.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            to="/me"
            className="text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 px-4 py-2 rounded-full transition-colors"
          >
            Track status
          </Link>
          <Link to="/" className="text-sm font-medium text-neutral-400 hover:text-neutral-100 px-4 py-2 transition-colors">
            Back to feed
          </Link>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <audio ref={probeRef} className="hidden" />
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-800">
          <h2 className="text-lg font-semibold text-neutral-100">Upload a track</h2>
          <p className="text-sm text-neutral-500 mt-1">
            Title, artist, duration and cover are filled automatically from the file's metadata. Your track goes
            to moderation first and is published after verification.
          </p>
        </div>

        <div className="p-6 flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-neutral-400">Audio file</span>
              <FileZone
                accept="audio/*,.wav,.flac,.ogg,.m4a,.aac,.opus"
                title="Choose or drop audio"
                hint="WAV, FLAC, OGG, M4A, OPUS up to 60 MB"
                selected={audio}
                onSelect={pickAudio}
                onClear={() => setAudio(null)}
                icon={<Music2 className="w-6 h-6" />}
                error={!audio ? error : null}
              />
              {audio && duration > 0 && (
                <span className="text-xs text-neutral-500">Duration: {formatTime(duration)}</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-neutral-400">Cover (optional)</span>
              <FileZone
                accept="image/jpeg,image/png,image/webp,image/gif"
                title="Choose a cover"
                hint="Square image, JPEG/PNG/WebP"
                selected={cover}
                onSelect={pickCover}
                onClear={clearCover}
                icon={<ImagePlus className="w-6 h-6" />}
                preview={coverPreview}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Auto-filled from file metadata"
                  className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-900 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Artist
                </label>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  maxLength={120}
                  placeholder="Auto-filled from file metadata"
                  className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-900 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Tell listeners about this track…"
                className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-900 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm resize-none"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Genre (optional)
                </label>
                <input
                  type="text"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. ambient, techno, hip-hop"
                  className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-900 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  License
                </label>
                <select
                  value={license}
                  onChange={(e) => setLicense(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-900 text-neutral-100 focus:outline-none focus:border-neutral-600 transition-colors text-sm"
                >
                  <option value="all rights reserved">All rights reserved</option>
                  <option value="creative commons attribution">CC Attribution (CC BY)</option>
                  <option value="creative commons share-alike">CC BY-SA</option>
                  <option value="creative commons non-commercial">CC BY-NC</option>
                  <option value="creative commons zero">CC0 Public Domain</option>
                </select>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-sm text-red-400"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-neutral-600">
              Files are kept on the server. Downloads are open to everyone.
            </span>
            <button
              onClick={submit}
              disabled={submitting || !audio}
              className="inline-flex items-center gap-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed px-6 py-2.5 rounded-full transition-colors"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              {submitting ? 'Uploading…' : 'Upload for review'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
