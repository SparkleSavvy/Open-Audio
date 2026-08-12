import { useRef, useState, FormEvent } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Upload, LogOut, Library, AudioLines, ShieldCheck, Bell, User, Settings } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useNotifications } from '../lib/NotificationsContext';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/library', label: 'Library' },
  { to: '/studio', label: 'Studio' },
];

export default function Header() {
  const { user, logout } = useAuth();
  const { unread } = useNotifications();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/search${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`);
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-neutral-950 border-b border-neutral-900">
      <div className="flex items-center justify-between h-16 px-4 sm:px-6 mx-auto max-w-[1600px]">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 bg-neutral-100 rounded-sm flex items-center justify-center">
              <AudioLines className="w-4 h-4 text-neutral-950" strokeWidth={2.5} />
            </div>
            <span className="text-lg font-semibold tracking-tight text-neutral-100">
              OPEN&nbsp;AUDIO
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {({ isActive }) => (
                  <span
                    className={`relative block px-3 py-1.5 rounded-md text-sm font-medium press ${
                      isActive ? 'text-neutral-100' : 'text-neutral-400 hover:text-neutral-100'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-md bg-neutral-900"
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                      />
                    )}
                    <span className="relative z-10">{item.label}</span>
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        <form onSubmit={submitSearch} className="flex-1 max-w-xl px-4 hidden lg:block">
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-neutral-500 group-focus-within:text-neutral-300 transition-colors" />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-neutral-800 rounded-md leading-5 bg-neutral-900 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:bg-neutral-800 focus:border-neutral-600 transition-colors sm:text-sm"
              placeholder="Search tracks, artists..."
            />
          </div>
        </form>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                to="/studio"
                className="hidden sm:flex items-center gap-2 text-sm font-medium text-neutral-100 bg-neutral-900 hover:bg-neutral-800 px-3.5 py-1.5 rounded-full border border-neutral-800 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Upload
              </Link>

              <Link
                to="/notifications"
                className="relative w-8 h-8 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-100 hover:bg-neutral-900 transition-colors"
                title="Notifications"
              >
                <Bell className="w-4.5 h-4.5" />
                <AnimatePresence>
                  {unread > 0 && (
                    <motion.span
                      key={unread}
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ type: 'spring', bounce: 0.4, duration: 0.4 }}
                      className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-neutral-100 text-neutral-950 text-[10px] font-bold flex items-center justify-center tabular-nums"
                    >
                      {unread > 99 ? '99+' : unread}
                    </motion.span>
                  )}
                </AnimatePresence>
              </Link>

              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="w-8 h-8 rounded-full overflow-hidden bg-neutral-800 border border-neutral-700 hover:border-neutral-500 transition-colors"
                >
                  <span className="flex items-center justify-center w-full h-full text-xs font-semibold text-neutral-200 uppercase">
                    {user.username.slice(0, 2)}
                  </span>
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 z-50 mt-2 w-52 rounded-lg border border-neutral-800 bg-neutral-900 shadow-xl overflow-hidden">
                      <div className="px-4 py-3 border-b border-neutral-800">
                        <p className="text-sm font-medium text-neutral-100 truncate">{user.username}</p>
                        <p className="text-xs text-neutral-500 truncate">{user.email || 'No email'}</p>
                      </div>
                      <Link
                        to="/studio"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
                      >
                        <Upload className="w-4 h-4" /> Studio
                      </Link>
                      <Link
                        to="/me"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
                      >
                        <Library className="w-4 h-4" /> My uploads
                      </Link>
                      <Link
                        to={`/user/${user.id}`}
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
                      >
                        <User className="w-4 h-4" /> My profile
                      </Link>
                      <Link
                        to="/settings"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
                      >
                        <Settings className="w-4 h-4" /> Settings
                      </Link>
                      {(user.role === 'admin' || user.role === 'owner') && (
                        <Link
                          to="/admin"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors"
                        >
                          <ShieldCheck className="w-4 h-4" /> Admin panel
                        </Link>
                      )}
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          logout();
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-neutral-800 transition-colors"
                      >
                        <LogOut className="w-4 h-4" /> Log out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="text-sm font-medium text-neutral-300 hover:text-neutral-100 px-3 py-1.5 rounded-full transition-colors"
              >
                Log in
              </Link>
              <Link
                to="/register"
                className="text-sm font-medium text-neutral-950 bg-neutral-100 hover:bg-neutral-300 px-4 py-1.5 rounded-full transition-colors"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
