import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';

const PrivacyContext = createContext(null);

export function PrivacyProvider({ children }) {
  const { token } = useAuth();
  const [settings, setSettings] = useState(null);

  const refresh = useCallback(async () => {
    if (!token) { setSettings(null); return; }
    const { data } = await api.get('/privacy');
    setSettings(data);
  }, [token]);

  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  const updateField = useCallback(async (field, value) => {
    const previous = settings?.[field];
    setSettings((s) => ({ ...s, [field]: value }));
    try {
      const { data } = await api.patch('/privacy', { field, value });
      setSettings(data.settings);
      return data.settings;
    } catch (e) {
      setSettings((s) => ({ ...s, [field]: previous }));
      throw e;
    }
  }, [settings]);

  return <PrivacyContext.Provider value={{ settings, refresh, setSettings, updateField }}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error('usePrivacy must be used inside PrivacyProvider');
  return ctx;
}
