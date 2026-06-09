import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import apiClient from '../api/client';
import { AlertTriangle, Plus, ExternalLink, Briefcase } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Disputes() {
  const { user } = useAuth();
  const [disputes, setDisputes] = useState<any[]>([]);
  const [activeJobs, setActiveJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showRaiseForm, setShowRaiseForm] = useState(false);
  
  // Form state
  const [selectedJobId, setSelectedJobId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchDisputes = async () => {
    try {
      const res = await apiClient.get('/disputes/my');
      setDisputes(res.data.disputes || []);
    } catch (err) {
      console.error('Failed to load disputes', err);
      setError('Failed to load disputes list.');
    }
  };

  const fetchActiveJobs = async () => {
    try {
      if (user?.role === 'CLIENT') {
        const res = await apiClient.get('/jobs/my');
        // Filter jobs that are in progress
        const inProgress = (res.data.jobs || []).filter((j: any) => j.status === 'IN_PROGRESS');
        setActiveJobs(inProgress);
      } else if (user?.role === 'FREELANCER') {
        const res = await apiClient.get('/bids/my');
        // Find jobs associated with accepted bids that are in progress
        const inProgress = (res.data.bids || [])
          .filter((b: any) => b.status === 'ACCEPTED' && b.job?.status === 'IN_PROGRESS')
          .map((b: any) => b.job);
        setActiveJobs(inProgress);
      }
    } catch (err) {
      console.error('Failed to load active jobs for disputes', err);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchDisputes(), fetchActiveJobs()]);
      setLoading(false);
    };
    init();
  }, [user]);

  const handleRaiseDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJobId || reason.trim().length < 10) {
      setError('Please select a job and provide a detailed reason (at least 10 characters).');
      return;
    }

    setError('');
    setSuccess('');
    setSubmitting(true);

    try {
      await apiClient.post(`/disputes/${selectedJobId}`, { reason });
      setSuccess('Dispute raised successfully. Escrow funds for this job are frozen.');
      setReason('');
      setSelectedJobId('');
      setShowRaiseForm(false);
      
      // Refresh data
      await Promise.all([fetchDisputes(), fetchActiveJobs()]);
    } catch (err: any) {
      const errMsg = err.response?.data?.error || 'Failed to raise dispute.';
      setError(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      OPEN: 'badge-progress',
      UNDER_REVIEW: 'badge-progress',
      RESOLVED: 'badge-completed',
    };
    return <span className={`badge ${map[status] || ''}`}>{status.replace('_', ' ')}</span>;
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Disputes & Resolution</h1>
          <p className="page-subtitle">File disputes to hold escrow funds or view resolution progress</p>
        </div>
        {activeJobs.length > 0 && !showRaiseForm && (
          <button className="btn btn-primary" onClick={() => setShowRaiseForm(true)}>
            <Plus size={16} /> File Dispute
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Raise Dispute Form Container */}
      {showRaiseForm && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2 className="card-title">File a New Dispute</h2>
          </div>
          <form onSubmit={handleRaiseDispute}>
            <div className="form-group">
              <label className="form-label">Select Active Project</label>
              <select 
                className="form-input" 
                value={selectedJobId} 
                onChange={e => setSelectedJobId(e.target.value)}
                required
              >
                <option value="">-- Choose a project in progress --</option>
                {activeJobs.map(job => (
                  <option key={job.id} value={job.id}>{job.title} (Budget: ${job.budget})</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Reason for Dispute</label>
              <textarea 
                className="form-input" 
                rows={4}
                placeholder="Please describe why you are disputing this project (milestone not met, quality of work, non-communication etc.). Minimum 10 characters."
                value={reason} 
                onChange={e => setReason(e.target.value)}
                required
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowRaiseForm(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Submitting...' : 'File Dispute'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : disputes.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <AlertTriangle />
            <h3>No disputes raised</h3>
            <p>
              {activeJobs.length > 0 
                ? "Everything looks good! If you run into issues on a project, you can file a dispute to freeze escrow funds." 
                : "You have no active projects in progress to file disputes on."}
            </p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Your Dispute Records</h2>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Job Title</th>
                  <th>Raised By</th>
                  <th>Reason</th>
                  <th>Date Opened</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((dispute: any) => (
                  <tr key={dispute.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{dispute.job?.title}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>Job status: {dispute.job?.status}</div>
                    </td>
                    <td>{dispute.raisedBy?.name} ({dispute.raisedBy?.role})</td>
                    <td style={{ maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {dispute.reason}
                    </td>
                    <td>{new Date(dispute.createdAt).toLocaleDateString()}</td>
                    <td>{getStatusBadge(dispute.status)}</td>
                    <td>
                      <Link to={`/jobs/${dispute.jobId}`} className="btn btn-secondary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        View Project <ExternalLink size={12} />
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
