import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import type { ReactNode } from 'react';
import Landing from './pages/Landing';
import Instructions from './pages/Instructions';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';

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
          <Route path="/test" element={<div>Test mode (todo)</div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
