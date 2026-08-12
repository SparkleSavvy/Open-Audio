import UploadForm from '../components/UploadForm';

export default function UploadPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Upload</h1>
        <p className="text-sm text-neutral-400 mt-1">Share your music — no limits on downloads</p>
      </div>
      <UploadForm />
    </div>
  );
}
