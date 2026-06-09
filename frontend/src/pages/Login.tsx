import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Lock, Mail } from 'lucide-react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await apiClient.post('/auth/login', { email, password });
      
      if (response.data.requiresMfa) {
        setRequiresMfa(true);
      } else {
        login(response.data.user);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await apiClient.post('/auth/login/mfa', { token: mfaCode });
      login(response.data.user);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid MFA code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">
          {requiresMfa ? 'Two-Factor Authentication' : 'Welcome back'}
        </h1>
        <p className="auth-subtitle">
          {requiresMfa
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'Sign in to your Freelanci account'}
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        {!requiresMfa ? (
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" required className="form-input" placeholder="you@example.com"
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input type="password" required className="form-input" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleMfaSubmit}>
            <div className="form-group">
              <label className="form-label">Authentication Code</label>
              <input type="text" required maxLength={6} className="form-input"
                style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: 24 }}
                placeholder="000000"
                value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))} />
            </div>
            <button type="submit" disabled={loading || mfaCode.length !== 6}
              className="btn btn-primary btn-lg" style={{ width: '100%' }}>
              {loading ? 'Verifying...' : 'Verify Code'}
            </button>
          </form>
        )}

        <div className="auth-footer">
          Don't have an account? <Link to="/register">Sign up</Link>
        </div>
      </div>
    </div>
  );
};
