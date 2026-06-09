import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import apiClient from '../api/client';
import { Link } from 'react-router-dom';
import { Plus, Search, Briefcase } from 'lucide-react';

export function Jobs() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({ title: '', description: '', budget: '', skills: '' });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchJobs = async () => {
    try {
      const endpoint = user?.role === 'CLIENT' ? '/jobs/my' : `/jobs?search=${search}`;
      const res = await apiClient.get(endpoint);
      setJobs(res.data.jobs || []);
    } catch (err) {
      console.error('Failed to load jobs', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, [search]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await apiClient.post('/jobs', {
        title: formData.title,
        description: formData.description,
        budget: formData.budget,
        skills: formData.skills.split(',').map(s => s.trim()).filter(Boolean)
      });
      setShowCreate(false);
      setFormData({ title: '', description: '', budget: '', skills: '' });
      fetchJobs();
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Failed to create job');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      OPEN: 'badge-open', IN_PROGRESS: 'badge-progress',
      COMPLETED: 'badge-completed', DISPUTED: 'badge-disputed',
      CANCELLED: 'badge-cancelled',
    };
    return <span className={`badge ${map[status] || ''}`}>{status.replace('_', ' ')}</span>;
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">{user?.role === 'CLIENT' ? 'My Jobs' : 'Browse Jobs'}</h1>
          <p className="page-subtitle">{user?.role === 'CLIENT' ? 'Manage your posted jobs' : 'Find your next project'}</p>
        </div>
        {user?.role === 'CLIENT' && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Post Job
          </button>
        )}
      </div>

      {user?.role !== 'CLIENT' && (
        <div style={{ marginBottom: 24, position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input
            className="form-input"
            placeholder="Search jobs by title or description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 36 }}
          />
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : jobs.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Briefcase />
            <h3>No jobs found</h3>
            <p>{user?.role === 'CLIENT' ? 'Post your first job to get started' : 'Try adjusting your search'}</p>
          </div>
        </div>
      ) : (
        <div className="job-list">
          {jobs.map((job: any) => (
            <Link key={job.id} to={`/jobs/${job.id}`} style={{ textDecoration: 'none' }}>
              <div className="job-card">
                <div className="job-card-header">
                  <span className="job-card-title">{job.title}</span>
                  <span className="job-card-budget">${job.budget?.toLocaleString()}</span>
                </div>
                <div className="job-card-description">{job.description}</div>
                <div className="job-card-footer">
                  <div className="job-card-skills">
                    {(job.skills || []).slice(0, 4).map((s: string) => (
                      <span key={s} className="skill-tag">{s}</span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="job-card-meta">{job._count?.bids || 0} bids</span>
                    {getStatusBadge(job.status)}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create Job Modal */}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Post a New Job</h2>
            {formError && <div className="alert alert-error">{formError}</div>}
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Job Title</label>
                <input className="form-input" required placeholder="e.g. Build a React Dashboard"
                  value={formData.title} onChange={e => setFormData({ ...formData, title: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-input" required placeholder="Describe the project requirements..."
                  value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Budget (USD)</label>
                <input className="form-input" type="number" required placeholder="500" min="1"
                  value={formData.budget} onChange={e => setFormData({ ...formData, budget: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Skills (comma-separated)</label>
                <input className="form-input" required placeholder="React, TypeScript, Node.js"
                  value={formData.skills} onChange={e => setFormData({ ...formData, skills: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Posting...' : 'Post Job'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
