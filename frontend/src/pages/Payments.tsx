import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import apiClient from '../api/client';
import { CreditCard, DollarSign, ArrowUpRight, CheckCircle, Lock, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Payments() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchTransactions = async () => {
    try {
      const res = await apiClient.get('/payments/history');
      setTransactions(res.data.transactions || []);
    } catch (err: any) {
      console.error('Failed to load transaction history', err);
      setError('Failed to load transaction history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  const handleRelease = async (jobId: string, txId: string) => {
    if (!window.confirm('Are you sure you want to release these funds to the freelancer? This action cannot be undone.')) {
      return;
    }
    setError('');
    setSuccess('');
    setProcessingId(txId);
    try {
      await apiClient.post(`/payments/release/${jobId}`);
      setSuccess('Escrow funds released to freelancer successfully.');
      fetchTransactions();
    } catch (err: any) {
      const errMsg = err.response?.data?.error || 'Failed to release funds.';
      setError(errMsg);
    } finally {
      setProcessingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      HELD: 'badge-progress',      // Escrow held (blue/amber)
      RELEASED: 'badge-completed',  // Released to freelancer (green)
      DISPUTED: 'badge-disputed',  // Frozen due to dispute (red)
    };
    return <span className={`badge ${map[status] || ''}`}>{status}</span>;
  };

  // Calculate summary stats
  const totalHeld = transactions
    .filter(t => t.status === 'HELD')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalReleased = transactions
    .filter(t => t.status === 'RELEASED')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalDisputed = transactions
    .filter(t => t.status === 'DISPUTED')
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Payments & Escrow</h1>
        <p className="page-subtitle">
          {user?.role === 'CLIENT'
            ? 'Manage funded milestones and release payments to freelancers'
            : 'Track your earnings and pending escrow milestones'}
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">
            <Lock size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--color-warning)' }} />
            Held in Escrow
          </div>
          <div className="stat-value" style={{ color: 'var(--color-warning-hover)' }}>
            ${totalHeld.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">
            <CheckCircle size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--color-success)' }} />
            {user?.role === 'CLIENT' ? 'Total Released' : 'Total Earned'}
          </div>
          <div className="stat-value" style={{ color: 'var(--color-success-hover)' }}>
            ${totalReleased.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">
            <ShieldAlert size={14} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--color-error)' }} />
            Disputed Funds
          </div>
          <div className="stat-value" style={{ color: 'var(--color-error)' }}>
            ${totalDisputed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : transactions.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <CreditCard />
            <h3>No transactions found</h3>
            <p>You haven't initiated or received any milestone payments yet.</p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Transaction History</h2>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Job Title</th>
                  <th>{user?.role === 'CLIENT' ? 'Freelancer' : 'Client'}</th>
                  <th>Amount</th>
                  <th>Date Created</th>
                  <th>Status</th>
                  {user?.role === 'CLIENT' && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx: any) => (
                  <tr key={tx.id}>
                    <td>
                      <Link to={`/jobs/${tx.jobId}`} style={{ fontWeight: 500, color: 'var(--color-text-title)', textDecoration: 'none' }}>
                        {tx.job?.title}
                      </Link>
                    </td>
                    <td>{user?.role === 'CLIENT' ? tx.freelancer?.name : tx.client?.name}</td>
                    <td style={{ fontWeight: 600 }}>${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td>{new Date(tx.createdAt).toLocaleDateString()}</td>
                    <td>{getStatusBadge(tx.status)}</td>
                    {user?.role === 'CLIENT' && (
                      <td>
                        {tx.status === 'HELD' ? (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={processingId === tx.id}
                            onClick={() => handleRelease(tx.jobId, tx.id)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <ArrowUpRight size={12} /> {processingId === tx.id ? 'Releasing...' : 'Release'}
                          </button>
                        ) : (
                          <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>—</span>
                        )}
                      </td>
                    )}
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
