import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { Activity, Shield, LogIn, LogOut, Key, AlertTriangle, Search } from 'lucide-react';

const ACTION_ICONS: Record<string, React.ReactNode> = {
  LOGIN_SUCCESS: <LogIn size={14} style={{ color: 'var(--color-success)' }} />,
  LOGIN_FAILED: <AlertTriangle size={14} style={{ color: 'var(--color-danger)' }} />,
  LOGOUT: <LogOut size={14} style={{ color: 'var(--color-text-secondary)' }} />,
  MFA_ENABLED: <Shield size={14} style={{ color: 'var(--color-success)' }} />,
  MFA_DISABLED: <Shield size={14} style={{ color: 'var(--color-warning)' }} />,
  MFA_VERIFICATION_FAILED: <Shield size={14} style={{ color: 'var(--color-danger)' }} />,
  PASSWORD_CHANGED: <Key size={14} style={{ color: 'var(--color-primary)' }} />,
  PASSWORD_EXPIRED: <Key size={14} style={{ color: 'var(--color-danger)' }} />,
  PASSWORD_FORCE_RESET: <Key size={14} style={{ color: 'var(--color-warning)' }} />,
  USER_REGISTERED: <LogIn size={14} style={{ color: 'var(--color-primary)' }} />,
  ACCOUNT_LOCKED: <AlertTriangle size={14} style={{ color: 'var(--color-danger)' }} />,
};

function getActionBadgeClass(action: string): string {
  if (action.includes('SUCCESS') || action.includes('ENABLED') || action === 'USER_REGISTERED') {
    return 'badge-completed';
  }
  if (action.includes('FAILED') || action.includes('LOCKED') || action.includes('EXPIRED')) {
    return 'badge-cancelled';
  }
  if (action.includes('DISABLED') || action.includes('FORCE_RESET')) {
    return 'badge-disputed';
  }
  return 'badge-progress';
}

function formatUserAgent(ua: string): string {
  if (!ua || ua === 'unknown') return 'Unknown';
  // Extract browser name from user agent string
  if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
  if (ua.includes('Edg')) return 'Edge';
  return ua.substring(0, 40) + (ua.length > 40 ? '…' : '');
}

export function ActivityLog() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchActivity = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (actionFilter) params.set('action', actionFilter);
      const res = await apiClient.get(`/auth/activity?${params}`);
      setLogs(res.data.logs || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch (err) {
      console.error('Failed to load activity log', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivity();
  }, [page, actionFilter]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Activity Log</h1>
        <p className="page-subtitle">
          Review your account security events — logins, MFA changes, password updates, and more
        </p>
      </div>

      {/* Filter */}
      <div style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} style={{
            position: 'absolute', left: 12, top: '50%',
            transform: 'translateY(-50%)', color: 'var(--color-text-muted)'
          }} />
          <input
            className="form-input"
            placeholder="Filter by action (e.g., LOGIN_SUCCESS, MFA_ENABLED, PASSWORD_CHANGED)..."
            value={actionFilter}
            onChange={e => { setActionFilter(e.target.value); setPage(1); }}
            style={{ paddingLeft: 36 }}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : logs.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Activity />
            <h3>No activity found</h3>
            <p>Your security events will appear here as you use the platform.</p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: '13px' }}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>IP Address</th>
                  <th>Browser</th>
                  <th>Details</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => (
                  <tr key={log.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {ACTION_ICONS[log.action] || <Activity size={14} />}
                        <span className={`badge ${getActionBadgeClass(log.action)}`}>
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </td>
                    <td>
                      <code style={{
                        fontSize: '12px', padding: '2px 6px',
                        background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)'
                      }}>
                        {log.ipAddress}
                      </code>
                    </td>
                    <td>
                      <span title={log.userAgent}>{formatUserAgent(log.userAgent)}</span>
                    </td>
                    <td style={{ maxWidth: '200px', wordBreak: 'break-all', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      {log.metadata ? JSON.stringify(log.metadata) : '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div>{new Date(log.timestamp).toLocaleDateString()}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, alignItems: 'center' }}>
              <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                Page {page} of {totalPages}
              </span>
              <button className="btn btn-secondary btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
