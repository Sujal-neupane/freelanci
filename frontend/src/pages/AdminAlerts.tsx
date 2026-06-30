import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { AlertTriangle, Check, ShieldAlert } from 'lucide-react';

export function AdminAlerts() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchAlerts = async () => {
    try {
      const res = await apiClient.get('/admin/alerts');
      setAlerts(res.data.alerts || []);
    } catch (err) {
      console.error('Failed to load alerts', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const handleAcknowledge = async (alertId: string) => {
    setProcessingId(alertId);
    try {
      await apiClient.patch(`/admin/alerts/${alertId}/acknowledge`);
      fetchAlerts();
    } catch (err) {
      console.error('Failed to acknowledge alert', err);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Security Alerts</h1>
        <p className="page-subtitle">Monitor high-risk events, account lockouts, and suspicious activities</p>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : alerts.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Check style={{ color: 'var(--color-success)' }} />
            <h3>No security alerts</h3>
            <p>All quiet! No security threats or abnormal behaviors detected.</p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Alert Type</th>
                  <th>Details</th>
                  <th>IP / Source</th>
                  <th>User Affected</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert: any) => (
                  <tr key={alert.id}>
                    <td>
                      <span className={`badge ${
                        alert.severity === 'HIGH' 
                          ? 'badge-cancelled' 
                          : alert.severity === 'MEDIUM' 
                          ? 'badge-disputed' 
                          : 'badge-progress'
                      }`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <ShieldAlert size={12} /> {alert.severity}
                      </span>
                    </td>
                    <td><strong style={{ color: 'var(--color-text-title)' }}>{alert.type}</strong></td>
                    <td style={{ maxWidth: '250px' }}>{alert.message}</td>
                    <td>{alert.ipAddress}</td>
                    <td>
                      {alert.user ? (
                        <div>
                          <strong>{alert.user.name}</strong>
                          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{alert.user.email}</div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>{new Date(alert.createdAt).toLocaleString()}</td>
                    <td>
                      {alert.acknowledged ? (
                        <span className="badge badge-completed">Acknowledged</span>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={processingId === alert.id}
                          onClick={() => handleAcknowledge(alert.id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <Check size={12} /> {processingId === alert.id ? 'Saving...' : 'Acknowledge'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
