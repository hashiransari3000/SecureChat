import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('securechat_token'));
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState(null);

  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem('securechat_token');
    if (!storedToken) { setUser(null); setToken(null); return null; }
    const { data } = await api.get('/users/me');
    setToken(storedToken);
    setUser(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      if (!localStorage.getItem('securechat_token')) {
        if (!cancelled) setInitializing(false);
        return;
      }
      try {
        const data = await refreshUser();
        if (cancelled || !data) return;
      } catch {
        if (!cancelled) {
          localStorage.removeItem('securechat_token');
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    restoreSession();
    return () => { cancelled = true; };
  }, [refreshUser]);

  const signup = useCallback(async (payload) => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.post('/auth/signup', payload);
      localStorage.setItem('securechat_token', data.token);
      setToken(data.token); setUser(data.user); return true;
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.'); return false;
    } finally { setLoading(false); }
  }, []);

  const login = useCallback(async ({ email, password }) => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('securechat_token', data.token);
      setToken(data.token); setUser(data.user); return true;
    } catch (err) {
      setError(err.response?.data?.error || 'The email or password is incorrect.'); return false;
    } finally { setLoading(false); }
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch {}
    localStorage.removeItem('securechat_token');
    setToken(null); setUser(null);
  }, []);

  const replaceUser = useCallback((nextUser) => setUser(nextUser), []);

  return <AuthContext.Provider value={{
    user, token, loading, initializing, error,
    signup, login, logout, refreshUser, replaceUser, setError,
  }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
