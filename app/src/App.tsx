import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import type { ReactNode } from 'react';
import Landing from './pages/Landing';
import Instructions from './pages/Instructions';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Lobby from './pages/Lobby';
import TestMode from './pages/TestMode';
import Game from './pages/Game';
import Jury from './pages/Jury';

function RequireAuth({ children }: { children: ReactNode }) {
  const { player } = useAuth();
  if (!player) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

export default function App() {
  const base = import.meta.env.BASE_URL;
  return (
    <AuthProvider>
      <BrowserRouter basename={base}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/instructions" element={<Instructions />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/test" element={<TestMode />} />
          <Route path="/lobby/:gameId" element={<RequireAuth><Lobby /></RequireAuth>} />
          <Route path="/game/:gameId" element={<RequireAuth><Game /></RequireAuth>} />
          <Route path="/game/:gameId/jury" element={<RequireAuth><Jury /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
