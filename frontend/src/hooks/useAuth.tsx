import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { getMe, logout as apiLogout } from '../api/auth';
import type { User } from '../api/auth';
import { useNavigate, useLocation } from 'react-router-dom';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (userData: User) => void;
  logout: () => Promise<void>;
  updateUser: (userData: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Exclude public routes from strict auth checks to prevent redirect loops
    const isPublicRoute = ['/login', '/register', '/mfa-setup'].includes(location.pathname);
    
    getMe()
      .then((userData) => {
        setUser(userData);
        if (isPublicRoute) {
          navigate('/dashboard');
        }
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []); // Only run once on mount

  const login = (userData: User) => {
    setUser(userData);
    navigate('/dashboard');
  };

  const logout = async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
      navigate('/login');
    }
  };

  const updateUser = (userData: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...userData } : null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
