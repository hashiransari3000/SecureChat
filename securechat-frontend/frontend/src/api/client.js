import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('securechat_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// If the token is expired/invalid, boot the user back to login instead of
// showing a confusing broken UI.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isAuthAttempt = String(err.config?.url || '').startsWith('/auth/');
    if (err.response?.status === 401 && !isAuthAttempt && localStorage.getItem('securechat_token')) {
      localStorage.removeItem('securechat_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
