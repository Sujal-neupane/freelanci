import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { Sidebar } from './components/Sidebar';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { MFASetup } from './pages/MFASetup';
import { Dashboard } from './pages/Dashboard';
import { Jobs } from './pages/Jobs';
import { JobDetail } from './pages/JobDetail';
import { Settings } from './pages/Settings';
import { Bids } from './pages/Bids';
import { Payments } from './pages/Payments';
import { Disputes } from './pages/Disputes';
import { AdminUsers } from './pages/AdminUsers';
import { AdminAuditLogs } from './pages/AdminAuditLogs';
import { AdminAlerts } from './pages/AdminAlerts';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
};

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
};

const ProtectedPage = ({ children }: { children: React.ReactNode }) => (
  <ProtectedRoute>
    <AppLayout>{children}</AppLayout>
  </ProtectedRoute>
);

const AppContent = () => {
  useIdleTimeout();

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/mfa-setup" element={
        <ProtectedRoute><MFASetup /></ProtectedRoute>
      } />
      <Route path="/dashboard" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
      <Route path="/jobs" element={<ProtectedPage><Jobs /></ProtectedPage>} />
      <Route path="/jobs/:id" element={<ProtectedPage><JobDetail /></ProtectedPage>} />
      <Route path="/bids" element={<ProtectedPage><Bids /></ProtectedPage>} />
      <Route path="/payments" element={<ProtectedPage><Payments /></ProtectedPage>} />
      <Route path="/disputes" element={<ProtectedPage><Disputes /></ProtectedPage>} />
      <Route path="/admin/users" element={<ProtectedPage><AdminUsers /></ProtectedPage>} />
      <Route path="/admin/audit-logs" element={<ProtectedPage><AdminAuditLogs /></ProtectedPage>} />
      <Route path="/admin/alerts" element={<ProtectedPage><AdminAlerts /></ProtectedPage>} />
      <Route path="/settings" element={<ProtectedPage><Settings /></ProtectedPage>} />
    </Routes>
  );
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
