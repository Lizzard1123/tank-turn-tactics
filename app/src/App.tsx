import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import type { ReactNode } from 'react';
import Landing from './pages/Landing';
import Instructions from './pages/Instructions';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Play from './pages/Play';
import Profile from './pages/Profile';
import ConfigView from './pages/ConfigView';
import Lobby from './pages/Lobby';
import TestMode from './pages/TestMode';
import Game from './pages/Game';
import Jury from './pages/Jury';
import { LocalGameProvider } from './lib/localGameContext';

function RequireAuth({ children }: { children: ReactNode }) {
  const { player } = useAuth();
  if (!player) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

export default function App() {
  const base = import.meta.env.BASE_URL;
  return (
    <AuthProvider>
      <LocalGameProvider>
        <BrowserRouter basename={base}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/play" element={<RequireAuth><Play /></RequireAuth>} />
            <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
            <Route path="/config" element={<RequireAuth><ConfigView /></RequireAuth>} />
            <Route path="/config/:gameId" element={<RequireAuth><ConfigView /></RequireAuth>} />
            <Route path="/instructions" element={<Instructions />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/games" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/test" element={<TestMode />} />
            <Route path="/lobby/:gameId" element={<RequireAuth><Lobby /></RequireAuth>} />
            <Route path="/game/:gameId" element={<RequireAuth><Game /></RequireAuth>} />
            <Route path="/game/:gameId/jury" element={<RequireAuth><Jury /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </LocalGameProvider>
    </AuthProvider>
  );
}
