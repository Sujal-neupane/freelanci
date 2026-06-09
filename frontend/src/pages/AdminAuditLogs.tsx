import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { FileText, Search } from 'lucide-react';

export function AdminAuditLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchLogs = async () => {
    try {
      const res = await apiClient.get(`/admin/audit-logs?page=${page}&action=${actionFilter}`);
      setLogs(res.data.logs || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, actionFilter]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Audit Logs</h1>
        <p className="page-subtitle">Track and review security events and user activities across the platform</p>
      </div>

      <div style={{ marginBottom: 24, display: 'flex', gap: 12 }}>
        <input
          className="form-input"
          placeholder="Filter by action (e.g., LOGIN_FAILED, PAYMENT_RELEASED)..."
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setPage(1); }}
        />
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : logs.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <FileText />
            <h3>No audit logs found</h3>
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: '13px' }}>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>User / Context</th>
                  <th>IP Address</th>
                  <th>User Agent</th>
                  <th>Metadata</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => (
                  <tr key={log.id}>
                    <td>
                      <span className={`badge ${
                        log.action.includes('SUCCESS') || log.action.includes('CREATED') || log.action.includes('RELEASED')
                          ? 'badge-completed'
                          : log.action.includes('FAILED') || log.action.includes('LOCKED')
                          ? 'badge-cancelled'
                          : 'badge-progress'
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td>
                      {log.user ? (
                        <div>
                          <strong>{log.user.name}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>{log.user.email}</div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)' }}>System / Anonymous</span>
                      )}
                    </td>
                    <td>{log.ipAddress}</td>
                    <td style={{ maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.userAgent}>
                      {log.userAgent}
                    </td>
                    <td style={{ maxWidth: '200px', wordBreak: 'break-all' }}>
                      {log.metadata ? JSON.stringify(log.metadata) : '—'}
                    </td>
                    <td>{new Date(log.timestamp).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</button>
              <span style={{ alignSelf: 'center', fontSize: '14px' }}>Page {page} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
