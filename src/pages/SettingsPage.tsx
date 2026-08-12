import { useState, FormEvent, useCallback, useEffect } from 'react';
import { ShieldCheck, ShieldOff, Loader2, Copy, Check } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { api, ApiError } from '../lib/api';
import type { TwoFaSetup } from '../types';

export default function SettingsPage() {
  const { user, refresh } = useAuth();

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-neutral-100">Settings</h1>
      <p className="text-sm text-neutral-400 mt-0.5 mb-8">Security and account options</p>

      {user && <TwoFactorSection enabled={user.twoFactorEnabled} refresh={refresh} />}
    </div>
  );
}

function TwoFactorSection({ enabled, refresh }: { enabled: boolean; refresh: () => Promise<void> }) {
  const [setup, setSetup] = useState<TwoFaSetup | null>(null);
  const [code, setCode] = useState('');
  const [savedCodes, setSavedCodes] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  useEffect(() => {
    setError(null);
  }, [setup]);

  const beginSetup = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.start2fa();
      setSetup(s);
      setCode('');
      setSavedCodes(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, []);

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    if (!setup) return;
    setBusy(true);
    setError(null);
    try {
      await api.enable2fa(setup.secret, code.trim(), setup.recoveryCodes);
      setSetup(null);
      setCode('');
      setSavedCodes(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.disable2fa(password);
      setPassword('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const cancelSetup = () => {
    setSetup(null);
    setCode('');
    setSavedCodes(false);
    setError(null);
  };

  if (setup) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 flex flex-col gap-5">
        <div>
          <h2 className="text-sm font-medium text-neutral-200">Set up authenticator app</h2>
          <p className="text-xs text-neutral-500 mt-1">
            Scan the QR code with your authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit
            code below to confirm.
          </p>
        </div>

        <div className="flex items-center gap-5">
          <img
            src={setup.qrDataUrl}
            alt="2FA QR code"
            className="w-36 h-36 rounded-lg border border-neutral-800 bg-white p-2"
          />
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <p className="text-xs text-neutral-500">Secret</p>
            <div className="flex items-center gap-2">
              <code className="text-xs text-neutral-200 bg-neutral-950 rounded-md px-3 py-2 font-mono truncate">
                {setup.secret}
              </code>
              <button
                type="button"
                onClick={() => copyText(setup.secret, 'secret')}
                className="shrink-0 text-neutral-500 hover:text-neutral-200 transition-colors"
                title="Copy secret"
              >
                {copied === 'secret' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-neutral-600 break-all">
              Can&apos;t scan? Open{' '}
              <span className="text-neutral-400">{setup.otpauthUrl}</span> in your app.
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs text-neutral-500 mb-2">
            Recovery codes — write these down. Each can be used once to sign in if you lose your authenticator.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {setup.recoveryCodes.map((rc) => (
              <div key={rc} className="flex items-center justify-between bg-neutral-950 rounded-md px-3 py-2">
                <code className="text-xs text-neutral-200 font-mono">{rc}</code>
                <button
                  type="button"
                  onClick={() => copyText(rc, rc)}
                  className="text-neutral-500 hover:text-neutral-200 transition-colors"
                  title="Copy"
                >
                  {copied === rc ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-sm text-neutral-300 cursor-pointer">
          <input
            type="checkbox"
            checked={savedCodes}
            onChange={(e) => setSavedCodes(e.target.checked)}
            className="accent-neutral-100"
          />
          I have saved my recovery codes
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <form onSubmit={enable} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">Code</label>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm font-mono tracking-widest"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || !code.trim() || !savedCodes}
              className="inline-flex items-center gap-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-full transition-colors"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Enable two-factor
            </button>
            <button
              type="button"
              onClick={cancelSetup}
              disabled={busy}
              className="text-sm text-neutral-500 hover:text-neutral-200 px-4 py-2.5 rounded-full transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-neutral-800 text-neutral-400'
            }`}
          >
            {enabled ? <ShieldCheck className="w-5 h-5" /> : <ShieldOff className="w-5 h-5" />}
          </div>
          <div>
            <h2 className="text-sm font-medium text-neutral-200">Two-factor authentication</h2>
            <p className="text-xs text-neutral-500 mt-1 max-w-md">
              {enabled
                ? 'Enabled. Your account requires an authenticator code after your password at every login.'
                : 'Add a second factor to your account. You will need your password plus a 6-digit code from an authenticator app to log in.'}
            </p>
          </div>
        </div>
        {!enabled && (
          <button
            onClick={beginSetup}
            disabled={busy}
            className="inline-flex items-center gap-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 disabled:opacity-40 px-4 py-2 rounded-full transition-colors shrink-0"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Enable
          </button>
        )}
      </div>

      {enabled && (
        <form onSubmit={disable} className="flex flex-col gap-3 border-t border-neutral-800 pt-4">
          <div>
            <label className="block text-xs font-medium text-neutral-400 mb-1.5">
              Password to confirm
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Your password"
              className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {notice && <p className="text-sm text-emerald-400">{notice}</p>}
          <button
            type="submit"
            disabled={busy || !password}
            className="inline-flex items-center gap-2 text-sm font-medium text-red-400 hover:text-red-300 bg-red-500/10 border border-red-500/30 rounded-full px-4 py-2 transition-colors disabled:opacity-40 w-fit"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Disable two-factor
          </button>
        </form>
      )}
    </div>
  );
}
