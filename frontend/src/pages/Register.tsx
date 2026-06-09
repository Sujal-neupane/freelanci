import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/client';
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter';

export const Register: React.FC = () => {
  const [formData, setFormData] = useState({
    name: '', email: '', password: '', confirmPassword: '', role: 'CLIENT'
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/auth/register', {
        name: formData.name, email: formData.email,
        password: formData.password, role: formData.role
      });
      navigate('/login', { state: { message: 'Registration successful! Please sign in.' } });
    } catch (err: any) {
      const errorMsg = err.response?.data?.details?.join(', ') || err.response?.data?.error || 'Registration failed';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Create an account</h1>
        <p className="auth-subtitle">Join Freelanci to start hiring or freelancing</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input name="name" type="text" required className="form-input" placeholder="John Doe"
              value={formData.name} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label className="form-label">Email address</label>
            <input name="email" type="email" required className="form-input" placeholder="you@example.com"
              value={formData.email} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label className="form-label">Role</label>
            <select name="role" className="form-select" value={formData.role} onChange={handleChange}>
              <option value="CLIENT">I want to hire freelancers</option>
              <option value="FREELANCER">I am a freelancer</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input name="password" type="password" required className="form-input" placeholder="••••••••"
              value={formData.password} onChange={handleChange} />
            <PasswordStrengthMeter password={formData.password} />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input name="confirmPassword" type="password" required className="form-input" placeholder="••••••••"
              value={formData.confirmPassword} onChange={handleChange} />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
            {loading ? 'Creating account...' : 'Sign up'}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
};
