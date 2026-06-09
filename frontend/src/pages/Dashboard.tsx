import { useAuth } from '../hooks/useAuth';
import apiClient from '../api/client';
import { useState, useEffect } from 'react';
import { Briefcase, Users, FileText, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

interface DashboardStats {
  totalJobs?: number;
  activeJobs?: number;
  totalBids?: number;
  pendingPayments?: number;
}

export function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({});
  const [recentJobs, setRecentJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        if (user?.role === 'CLIENT') {
          const jobsRes = await apiClient.get('/jobs/my');
          const jobs = jobsRes.data.jobs || [];
          setRecentJobs(jobs.slice(0, 5));
          setStats({
            totalJobs: jobs.length,
            activeJobs: jobs.filter((j: any) => j.status === 'IN_PROGRESS').length,
            totalBids: jobs.reduce((acc: number, j: any) => acc + (j._count?.bids || 0), 0),
          });
        } else if (user?.role === 'FREELANCER') {
          const [jobsRes, bidsRes] = await Promise.all([
            apiClient.get('/jobs?limit=5'),
            apiClient.get('/jobs/my') // bids/my is mounted under /api/jobs
          ]);
          setRecentJobs(jobsRes.data.jobs || []);
          const bids = bidsRes.data.bids || [];
          setStats({
            totalJobs: jobsRes.data.pagination?.total || 0,
            totalBids: bids.length,
            activeJobs: bids.filter((b: any) => b.status === 'ACCEPTED').length,
          });
        } else if (user?.role === 'ADMIN') {
          const metricsRes = await apiClient.get('/admin/metrics');
          setStats(metricsRes.data.metrics);
        }
      } catch (err) {
        console.error('Failed to load dashboard data', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  if (loading) {
    return <div className="loading"><div className="spinner" /></div>;
  }

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
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          Welcome back, {user?.name}
          {!user?.mfaEnabled && (
            <> · <Link to="/mfa-setup" style={{ color: 'var(--color-warning)', fontWeight: 500 }}>Enable 2FA</Link></>
          )}
        </p>
      </div>

      <div className="stats-grid">
        {user?.role === 'ADMIN' ? (
          <>
            <div className="stat-card">
              <div className="stat-label"><Users size={14} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} /> Total Users</div>
              <div className="stat-value">{stats.totalJobs ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><Briefcase size={14} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} /> Total Jobs</div>
              <div className="stat-value">{stats.activeJobs ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><AlertTriangle size={14} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} /> Active Disputes</div>
              <div className="stat-value">{stats.totalBids ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label"><FileText size={14} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} /> Unread Alerts</div>
              <div className="stat-value">{stats.pendingPayments ?? 0}</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-card">
              <div className="stat-label">{user?.role === 'CLIENT' ? 'My Jobs' : 'Available Jobs'}</div>
              <div className="stat-value">{stats.totalJobs ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Active</div>
              <div className="stat-value">{stats.activeJobs ?? 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{user?.role === 'CLIENT' ? 'Total Bids Received' : 'My Bids'}</div>
              <div className="stat-value">{stats.totalBids ?? 0}</div>
            </div>
          </>
        )}
      </div>

      {user?.role !== 'ADMIN' && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">{user?.role === 'CLIENT' ? 'Recent Jobs' : 'Browse Jobs'}</h2>
            <Link to="/jobs" className="btn btn-secondary btn-sm">View All</Link>
          </div>
          {recentJobs.length === 0 ? (
            <div className="empty-state">
              <Briefcase />
              <h3>No jobs yet</h3>
              <p>{user?.role === 'CLIENT' ? 'Post your first job to get started' : 'No jobs available right now'}</p>
            </div>
          ) : (
            <div className="job-list">
              {recentJobs.map((job: any) => (
                <Link key={job.id} to={`/jobs/${job.id}`} style={{ textDecoration: 'none' }}>
                  <div className="job-card">
                    <div className="job-card-header">
                      <span className="job-card-title">{job.title}</span>
                      <span className="job-card-budget">${job.budget?.toLocaleString()}</span>
                    </div>
                    <div className="job-card-description">{job.description}</div>
                    <div className="job-card-footer">
                      <div className="job-card-skills">
                        {(job.skills || []).slice(0, 3).map((s: string) => (
                          <span key={s} className="skill-tag">{s}</span>
                        ))}
                      </div>
                      {getStatusBadge(job.status)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
