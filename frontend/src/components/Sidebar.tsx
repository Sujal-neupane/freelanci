import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  LayoutDashboard, Briefcase, FileText, CreditCard,
  Shield, AlertTriangle, LogOut, Settings
} from 'lucide-react';

export function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  if (!user) return null;

  const isActive = (path: string) => location.pathname === path;

  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/jobs', icon: Briefcase, label: 'Jobs' },
    { path: '/bids', icon: FileText, label: 'My Bids', roles: ['FREELANCER'] },
    { path: '/payments', icon: CreditCard, label: 'Payments' },
    { path: '/disputes', icon: AlertTriangle, label: 'Disputes' },
  ];

  const adminItems = [
    { path: '/admin/users', icon: Shield, label: 'Users' },
    { path: '/admin/audit-logs', icon: FileText, label: 'Audit Logs' },
    { path: '/admin/alerts', icon: AlertTriangle, label: 'Security Alerts' },
  ];

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <NavLink to="/dashboard" className="sidebar-logo">freelanci</NavLink>
      </div>

      <nav className="sidebar-nav">
        {navItems
          .filter(item => !item.roles || item.roles.includes(user.role))
          .map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={`sidebar-link ${isActive(item.path) ? 'active' : ''}`}
            >
              <item.icon />
              {item.label}
            </NavLink>
          ))
        }

        {user.role === 'ADMIN' && (
          <>
            <div style={{ 
              fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              padding: '16px 12px 6px', marginTop: '8px'
            }}>
              Admin
            </div>
            {adminItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                className={`sidebar-link ${isActive(item.path) ? 'active' : ''}`}
              >
                <item.icon />
                {item.label}
              </NavLink>
            ))}
          </>
        )}

        <div style={{ flex: 1 }} />

        <NavLink to="/settings" className={`sidebar-link ${isActive('/settings') ? 'active' : ''}`}>
          <Settings />
          Settings
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">{getInitials(user.name)}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-role">{user.role}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="sidebar-link"
          style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', marginTop: '4px' }}
        >
          <LogOut />
          Sign out
        </button>
      </div>
    </aside>
  );
}
