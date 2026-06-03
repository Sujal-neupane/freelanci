import axios from 'axios';

const apiClient = axios.create({
  baseURL: 'http://localhost:3001/api', // Uses standard dev port
  withCredentials: true, // Crucial for sending/receiving HttpOnly cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor to handle global 401s (session expired)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear any local state if needed and redirect
      // We don't forcefully reload if we are already on login page
      if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        window.location.href = '/login?expired=true';
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
