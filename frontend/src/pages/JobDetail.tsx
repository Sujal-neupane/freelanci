import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import apiClient from '../api/client';
import { ArrowLeft, DollarSign, Clock, User } from 'lucide-react';

export function JobDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bidAmount, setBidAmount] = useState('');
  const [bidProposal, setBidProposal] = useState('');
  const [bidError, setBidError] = useState('');
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const [showBidForm, setShowBidForm] = useState(false);

  useEffect(() => {
    const fetchJob = async () => {
      try {
        const res = await apiClient.get(`/jobs/${id}`);
        setJob(res.data.job);
      } catch {
        navigate('/jobs');
      } finally {
        setLoading(false);
      }
    };
    fetchJob();
  }, [id]);

  const handleBid = async (e: React.FormEvent) => {
    e.preventDefault();
    setBidError('');
    setBidSubmitting(true);
    try {
      await apiClient.post(`/jobs/${id}/bids`, { amount: bidAmount, proposal: bidProposal });
      setShowBidForm(false);
      // Refresh
      const res = await apiClient.get(`/jobs/${id}`);
      setJob(res.data.job);
    } catch (err: any) {
      setBidError(err.response?.data?.error || 'Failed to submit bid');
    } finally {
      setBidSubmitting(false);
    }
  };

  const handleHire = async (bidId: string) => {
    try {
      await apiClient.post(`/jobs/${id}/hire/${bidId}`);
      const res = await apiClient.get(`/jobs/${id}`);
      setJob(res.data.job);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to hire');
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      OPEN: 'badge-open', IN_PROGRESS: 'badge-progress',
      COMPLETED: 'badge-completed', DISPUTED: 'badge-disputed',
      CANCELLED: 'badge-cancelled', PENDING: 'badge-pending',
      ACCEPTED: 'badge-accepted', REJECTED: 'badge-rejected',
    };
    return <span className={`badge ${map[status] || ''}`}>{status.replace('_', ' ')}</span>;
  };

  if (loading) return <div className="loading"><div className="spinner" /></div>;
  if (!job) return null;

  const isOwner = job.clientId === user?.id;

  return (
    <div>
      <button className="btn btn-secondary btn-sm" onClick={() => navigate('/jobs')} style={{ marginBottom: 20 }}>
        <ArrowLeft size={16} /> Back to Jobs
      </button>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h1 className="page-title">{job.title}</h1>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Posted by {job.client?.name} · {new Date(job.createdAt).toLocaleDateString()}
            </p>
          </div>
          {getStatusBadge(job.status)}
        </div>

        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.7, marginBottom: 20 }}>
          {job.description}
        </p>

        <div style={{ display: 'flex', gap: 24, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            <DollarSign size={16} color="var(--color-primary)" />
            <strong>${job.budget?.toLocaleString()}</strong> budget
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            <Clock size={16} color="var(--color-text-muted)" />
            {job._count?.bids || 0} bids
          </div>
        </div>

        <div className="job-card-skills" style={{ marginBottom: 20 }}>
          {(job.skills || []).map((s: string) => (
            <span key={s} className="skill-tag">{s}</span>
          ))}
        </div>

        {user?.role === 'FREELANCER' && job.status === 'OPEN' && (
          <button className="btn btn-primary" onClick={() => setShowBidForm(!showBidForm)}>
            <DollarSign size={16} /> Place a Bid
          </button>
        )}
      </div>

      {/* Bid Form */}
      {showBidForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 className="card-title" style={{ marginBottom: 16 }}>Submit Your Bid</h2>
          {bidError && <div className="alert alert-error">{bidError}</div>}
          <form onSubmit={handleBid}>
            <div className="form-group">
              <label className="form-label">Your Bid Amount (USD)</label>
              <input className="form-input" type="number" required min="1" placeholder="Your price"
                value={bidAmount} onChange={e => setBidAmount(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Proposal</label>
              <textarea className="form-input" required placeholder="Explain why you're the best fit..."
                value={bidProposal} onChange={e => setBidProposal(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={bidSubmitting}>
                {bidSubmitting ? 'Submitting...' : 'Submit Bid'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowBidForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Bids Section (visible to job owner) */}
      {isOwner && job.bids && (
        <div className="card">
          <h2 className="card-title" style={{ marginBottom: 16 }}>Bids ({job.bids.length})</h2>
          {job.bids.length === 0 ? (
            <div className="empty-state">
              <User />
              <h3>No bids yet</h3>
              <p>Freelancers will submit their proposals here</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Freelancer</th>
                    <th>Amount</th>
                    <th>Proposal</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {job.bids.map((bid: any) => (
                    <tr key={bid.id}>
                      <td style={{ fontWeight: 500 }}>{bid.freelancer?.name}</td>
                      <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>${bid.amount?.toLocaleString()}</td>
                      <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {bid.proposal}
                      </td>
                      <td>{getStatusBadge(bid.status)}</td>
                      <td>
                        {bid.status === 'PENDING' && job.status === 'OPEN' && (
                          <button className="btn btn-primary btn-sm" onClick={() => handleHire(bid.id)}>Hire</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
