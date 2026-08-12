import { useState, FormEvent, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { AudioLines, Loader2, ShieldCheck, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../lib/AuthContext';
import { ApiError } from '../lib/api';

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, loading, login, login2fa, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [step, setStep] = useState<'credentials' | 'code'>('credentials');
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [freshRecoveryCodes, setFreshRecoveryCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (user && !loading && freshRecoveryCodes === null) navigate(from, { replace: true });
  }, [user, loading, navigate, from, freshRecoveryCodes]);

  if (loading) return <div className="h-40" />;

  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await register(username, email, password);
        navigate(from, { replace: true });
        return;
      }
      const result = await login(username, password);
      if ('need2fa' in result) {
        setPendingUserId(result.userId);
        setCode('');
        setStep('code');
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (pendingUserId === null) return;
    setBusy(true);
    setError(null);
    try {
      const recoveryCodes = await login2fa(pendingUserId, code);
      if (recoveryCodes) {
        setFreshRecoveryCodes(recoveryCodes);
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const isLogin = mode === 'login';

  return (
    <div className="flex justify-center pt-10">
      <motion.div
        key={step}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-neutral-100 rounded-sm flex items-center justify-center">
            <AudioLines className="w-6 h-6 text-neutral-950" strokeWidth={2.5} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-100">
            {freshRecoveryCodes ? 'Save your new recovery codes' : isLogin ? 'Welcome back' : 'Join Open Audio'}
          </h1>
          <p className="text-sm text-neutral-500 text-center">
            {freshRecoveryCodes
              ? 'You logged in with a recovery code — these replace your old ones. Store them somewhere safe.'
              : step === 'code'
                ? 'Enter the 6-digit code from your authenticator app'
                : isLogin
                  ? 'Log in to upload and manage your tracks'
                  : 'Upload music, get it reviewed, share it free'}
          </p>
        </div>

        {freshRecoveryCodes ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              {freshRecoveryCodes.map((rc) => (
                <code key={rc} className="text-center text-xs text-neutral-200 bg-neutral-950 rounded-md py-2 font-mono">
                  {rc}
                </code>
              ))}
            </div>
            <button
              onClick={() => navigate(from, { replace: true })}
              className="inline-flex items-center justify-center gap-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 px-4 py-2.5 rounded-full transition-colors mt-1"
            >
              Continue
            </button>
          </div>
        ) : step === 'code' ? (
          <form onSubmit={submitCode} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                Verification code
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                placeholder="000000"
                className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm font-mono tracking-widest"
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="inline-flex items-center justify-center gap-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-full transition-colors mt-1"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              <ShieldCheck className="w-4 h-4" />
              Verify
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('credentials');
                setError(null);
              }}
              className="inline-flex items-center justify-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Use a different account
            </button>
            <p className="text-xs text-neutral-600 text-center">
              Lost your authenticator? A single-use recovery code works here too.
            </p>
          </form>
        ) : (
          <form onSubmit={submitCredentials} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="yourname"
                className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm"
              />
            </div>
            {!isLogin && (
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1.5">
                  Email <span className="text-neutral-600 normal-case">(optional)</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-neutral-400 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                placeholder={isLogin ? '••••••••' : 'At least 6 characters'}
                className="w-full px-3.5 py-2.5 rounded-md border border-neutral-800 bg-neutral-950 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors text-sm"
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={busy || !username.trim() || password.length < 8}
              className="inline-flex items-center justify-center gap-2 text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-full transition-colors mt-1"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {isLogin ? 'Log in' : 'Create account'}
            </button>
          </form>
        )}

        {freshRecoveryCodes === null && step === 'credentials' && (
          <p className="text-center text-sm text-neutral-500 mt-5">
            {isLogin ? (
              <>
                No account yet?{' '}
                <Link to="/register" className="text-neutral-200 hover:underline font-medium">
                  Sign up
                </Link>
              </>
            ) : (
              <>
                Already registered?{' '}
                <Link to="/login" className="text-neutral-200 hover:underline font-medium">
                  Log in
                </Link>
              </>
            )}
          </p>
        )}
      </motion.div>
    </div>
  );
}
