import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { Link } from 'react-router-dom';
import { FileText, ExternalLink } from 'lucide-react';

export function Bids() {
  const [bids, setBids] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBids = async () => {
      try {
        const res = await apiClient.get('/bids/my');
        setBids(res.data.bids || []);
      } catch (err) {
        console.error('Failed to load bids', err);
      } finally {
        setLoading(false);
      }
    };
    fetchBids();
  }, []);

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING: 'badge-progress',
      ACCEPTED: 'badge-completed',
      REJECTED: 'badge-cancelled'
    };
    return <span className={`badge ${map[status] || ''}`}>{status}</span>;
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">My Bids</h1>
        <p className="page-subtitle">Track your submitted project proposals and their status</p>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : bids.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <FileText />
            <h3>No bids submitted</h3>
            <p>Browse available jobs and submit your first proposal to get started.</p>
            <Link to="/jobs" className="btn btn-primary" style={{ marginTop: 16 }}>Browse Jobs</Link>
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Job Title</th>
                  <th>Bid Amount</th>
                  <th>Proposal Snippet</th>
                  <th>Date Submitted</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bids.map((bid: any) => (
                  <tr key={bid.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{bid.job?.title}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Budget: ${bid.job?.budget}</div>
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                      ${bid.amount?.toLocaleString()}
                    </td>
                    <td style={{ maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {bid.proposal}
                    </td>
                    <td>{new Date(bid.createdAt).toLocaleDateString()}</td>
                    <td>{getStatusBadge(bid.status)}</td>
                    <td>
                      <Link to={`/jobs/${bid.jobId}`} className="btn btn-secondary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        View Job <ExternalLink size={12} />
                      </Link>
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
