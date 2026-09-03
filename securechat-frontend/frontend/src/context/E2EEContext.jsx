import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  ensureDeviceIdentity,
  recipientsForConversation,
  recipientsForUser,
  encryptPayload,
  encryptPayloadWithAttachment,
  decryptPayload,
  decryptAttachment,
  sanitizeImageForSharing,
  deleteDeviceIdentity,
} from '../crypto/e2ee';

const E2EEContext = createContext(null);

export function E2EEProvider({ children }) {
  const { user } = useAuth();
  const userId = String(user?.id || user?._id || '');
  const [identity, setIdentity] = useState(null);
  const [status, setStatus] = useState('initializing');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!userId) return undefined;
    setStatus('initializing'); setError('');
    ensureDeviceIdentity(userId).then((next) => {
      if (!cancelled) { setIdentity(next); setStatus('ready'); }
    }).catch((e) => {
      if (!cancelled) { setError(e.message || 'Could not initialize encrypted messaging.'); setStatus('error'); }
    });
    return () => { cancelled = true; };
  }, [userId]);

  const encryptForConversation = useCallback(async (conversationId, payload) => {
    if (!identity) throw new Error('Encrypted device is still initializing.');
    const devices = await recipientsForConversation(conversationId);
    return encryptPayload(payload, devices);
  }, [identity]);

  const encryptForUser = useCallback(async (targetUserId, payload) => {
    if (!identity) throw new Error('Encrypted device is still initializing.');
    const devices = await recipientsForUser(targetUserId);
    return encryptPayload(payload, devices);
  }, [identity]);

  const encryptAttachmentForConversation = useCallback(async ({ conversationId, payload, file }) => {
    if (!identity) throw new Error('Encrypted device is still initializing.');
    const devices = await recipientsForConversation(conversationId);
    const bytes = await file.arrayBuffer();
    return encryptPayloadWithAttachment({ payload, fileBytes: bytes, devices, conversationId });
  }, [identity]);

  const decrypt = useCallback(async (message) => {
    if (!identity) throw new Error('Encrypted device is still initializing.');
    return decryptPayload(message, identity);
  }, [identity]);

  const openAttachment = useCallback(async (message, payload) => {
    if (!identity) throw new Error('Encrypted device is still initializing.');
    const bytes = await decryptAttachment(message, identity);
    const blob = new Blob([bytes], { type: payload?.attachment?.mimeType || 'application/octet-stream' });
    return URL.createObjectURL(blob);
  }, [identity]);

  const wipeLocalIdentity = useCallback(async () => {
    if (!userId) return;
    await deleteDeviceIdentity(userId);
    setIdentity(null);
    setStatus('initializing');
  }, [userId]);

  const value = useMemo(() => ({
    status, error, identity,
    encryptForConversation, encryptForUser, encryptAttachmentForConversation,
    decrypt, openAttachment, sanitizeImageForSharing, wipeLocalIdentity,
  }), [status, error, identity, encryptForConversation, encryptForUser, encryptAttachmentForConversation, decrypt, openAttachment, wipeLocalIdentity]);

  return <E2EEContext.Provider value={value}>{children}</E2EEContext.Provider>;
}

export function useE2EE() {
  const value = useContext(E2EEContext);
  if (!value) throw new Error('useE2EE must be used inside E2EEProvider');
  return value;
}
