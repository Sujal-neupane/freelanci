import { useState, useEffect } from 'react';
import apiClient from '../api/client';
import { Users, ShieldAlert, CheckCircle, Search } from 'lucide-react';

export function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await apiClient.get(`/admin/users?page=${page}&search=${search}`);
      setUsers(res.data.users || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
    } catch (err) {
      console.error('Failed to load admin users', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [page, search]);

  const handleSuspend = async (userId: string, currentSuspended: boolean) => {
    if (!window.confirm(`Are you sure you want to ${currentSuspended ? 'unsuspend' : 'suspend'} this user?`)) {
      return;
    }
    setProcessingId(userId);
    try {
      await apiClient.patch(`/admin/users/${userId}/suspend`, { suspend: !currentSuspended });
      fetchUsers();
    } catch (err) {
      console.error('Failed to update suspend status', err);
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">User Management</h1>
        <p className="page-subtitle">View and manage system users (suspend/unsuspend accounts)</p>
      </div>

      <div style={{ marginBottom: 24, position: 'relative' }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
        <input
          className="form-input"
          placeholder="Search users by name or email..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ paddingLeft: 36 }}
        />
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /></div>
      ) : users.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Users />
            <h3>No users found</h3>
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>{u.name}</td>
                    <td>{u.email}</td>
                    <td><span className={`badge ${u.role === 'ADMIN' ? 'badge-open' : 'badge-progress'}`}>{u.role}</span></td>
                    <td>
                      {u.suspended ? (
                        <span className="badge badge-cancelled" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <ShieldAlert size={12} /> Suspended
                        </span>
                      ) : (
                        <span className="badge badge-completed" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle size={12} /> Active
                        </span>
                      )}
                    </td>
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td>
                      {u.role !== 'ADMIN' ? (
                        <button
                          className={`btn ${u.suspended ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                          disabled={processingId === u.id}
                          onClick={() => handleSuspend(u.id, u.suspended)}
                        >
                          {processingId === u.id ? 'Processing...' : u.suspended ? 'Unsuspend' : 'Suspend'}
                        </button>
                      ) : (
                        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>—</span>
                      )}
                    </td>
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
