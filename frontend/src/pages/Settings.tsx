import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import apiClient from '../api/client';
import { Shield, Key, Lock } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Settings() {
  const { user, updateUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/auth/change-password', {
        currentPassword,
        newPassword
      });
      setSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage your account security</p>
      </div>

      {/* Security Overview */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-label"><Shield size={14} style={{ marginRight: 4 }} /> Two-Factor Auth</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {user?.mfaEnabled ? (
              <span style={{ color: 'var(--color-success)' }}>Enabled ✓</span>
            ) : (
              <Link to="/mfa-setup" style={{ color: 'var(--color-warning)', textDecoration: 'none' }}>Not Enabled</Link>
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><Key size={14} style={{ marginRight: 4 }} /> Account Role</div>
          <div className="stat-value" style={{ fontSize: 18 }}>{user?.role}</div>
        </div>
      </div>

      {/* Change Password */}
      <div className="card" style={{ maxWidth: 480 }}>
        <h2 className="card-title" style={{ marginBottom: 20 }}>
          <Lock size={18} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
          Change Password
        </h2>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <form onSubmit={handlePasswordChange}>
          <div className="form-group">
            <label className="form-label">Current Password</label>
            <input className="form-input" type="password" required
              value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input className="form-input" type="password" required
              value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm New Password</label>
            <input className="form-input" type="password" required
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
