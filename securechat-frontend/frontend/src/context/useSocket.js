import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket() {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('securechat_token');
    if (!token) return undefined;
    const instance = io(import.meta.env.VITE_API_URL || 'http://localhost:5000', { auth: { token } });
    setSocket(instance);
    return () => { instance.disconnect(); setSocket(null); };
  }, []);

  return socket;
}
