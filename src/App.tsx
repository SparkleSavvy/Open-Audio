import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { AuthProvider } from './lib/AuthContext';
import { PlayerProvider } from './lib/PlayerContext';
import { NotificationsProvider } from './lib/NotificationsContext';
import { usePrefersReducedMotion } from './lib/usePrefersReducedMotion';
import Header from './components/Header';
import Player from './components/Player';
import Toast from './components/Toast';
import ProtectedRoute from './components/ProtectedRoute';
import HomePage from './pages/HomePage';
import LibraryPage from './pages/LibraryPage';
import SearchPage from './pages/SearchPage';
import UploadPage from './pages/UploadPage';
import MyUploadsPage from './pages/MyUploadsPage';
import StudioPage from './pages/StudioPage';
import TrackDetailPage from './pages/TrackDetailPage';
import UserProfilePage from './pages/UserProfilePage';
import AuthPage from './pages/AuthPage';
import AdminPage from './pages/AdminPage';
import SettingsPage from './pages/SettingsPage';
import NotificationsPage from './pages/NotificationsPage';
import NotFoundPage from './pages/NotFoundPage';

function Layout() {
  const location = useLocation();
  const reduced = usePrefersReducedMotion();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 font-sans selection:bg-neutral-800 pb-32">
      <Header />
      <main className="mx-auto max-w-[1600px] px-4 sm:px-6 py-8">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <Player />
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NotificationsProvider>
        <PlayerProvider>
          <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="library" element={<LibraryPage />} />
              <Route path="search" element={<SearchPage />} />
              <Route
                path="upload"
                element={
                  <ProtectedRoute>
                    <UploadPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="me"
                element={
                  <ProtectedRoute>
                    <MyUploadsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="studio"
                element={
                  <ProtectedRoute>
                    <StudioPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="notifications"
                element={
                  <ProtectedRoute>
                    <NotificationsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="settings"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route path="track/:id" element={<TrackDetailPage />} />
              <Route path="user/:id" element={<UserProfilePage />} />
              <Route path="login" element={<AuthPage mode="login" />} />
              <Route path="register" element={<AuthPage mode="register" />} />
              <Route
                path="admin"
                element={
                  <ProtectedRoute adminOnly>
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        </PlayerProvider>
      </NotificationsProvider>
    </AuthProvider>
  );
}
