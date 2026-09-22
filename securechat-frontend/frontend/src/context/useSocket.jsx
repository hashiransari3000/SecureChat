import { useContext, useEffect, useState, createContext } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

// Single authenticated socket shared by the whole app so call signaling and
// presence work even when the chat page is not mounted.
export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('securechat_token');
    if (!token) return undefined;
    const instance = io(import.meta.env.VITE_API_URL || 'http://localhost:5000', { auth: { token } });
    setSocket(instance);
    return () => { instance.disconnect(); setSocket(null); };
  }, []);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}