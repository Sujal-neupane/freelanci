import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';
import { useAuth } from '../hooks/useAuth';

export const MFASetup: React.FC = () => {
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [manualEntryKey, setManualEntryKey] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(true);
  const navigate = useNavigate();
  const { updateUser } = useAuth();

  useEffect(() => {
    const fetchMfaSetup = async () => {
      try {
        const response = await apiClient.post('/auth/mfa/setup');
        setQrCodeUrl(response.data.qrCodeUrl);
        setManualEntryKey(response.data.manualEntryKey);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to initialize MFA setup');
      } finally {
        setSetupLoading(false);
      }
    };
    fetchMfaSetup();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiClient.post('/auth/mfa/verify-setup', { token });
      updateUser({ mfaEnabled: true });
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 460 }}>
        <h1 className="auth-title">Set up Two-Factor Auth</h1>
        <p className="auth-subtitle">Secure your account with an authenticator app</p>

        {error && <div className="alert alert-error">{error}</div>}

        {setupLoading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : (
          <>
            <div style={{
              background: 'var(--color-bg)', borderRadius: 'var(--radius-lg)',
              padding: 20, textAlign: 'center', marginBottom: 24
            }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
                1. Scan this QR code with your authenticator app
              </p>
              {qrCodeUrl && (
                <img src={qrCodeUrl} alt="MFA QR Code"
                  style={{ width: 180, height: 180, background: 'white', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)' }} />
              )}
              <div style={{ marginTop: 12 }}>
                <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>Or enter this key manually:</p>
                <code style={{
                  display: 'block', padding: 8, background: 'var(--color-surface)',
                  borderRadius: 'var(--radius-sm)', fontSize: 13, wordBreak: 'break-all',
                  border: '1px solid var(--color-border)'
                }}>
                  {manualEntryKey}
                </code>
              </div>
            </div>

            <form onSubmit={handleVerify}>
              <div className="form-group">
                <label className="form-label">2. Enter the 6-digit code to verify</label>
                <input type="text" required maxLength={6} className="form-input"
                  style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: 24 }}
                  placeholder="000000"
                  value={token} onChange={e => setToken(e.target.value.replace(/\D/g, ''))} />
              </div>
              <button type="submit" disabled={loading || token.length !== 6}
                className="btn btn-primary btn-lg" style={{ width: '100%' }}>
                {loading ? 'Verifying...' : 'Verify & Enable'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
