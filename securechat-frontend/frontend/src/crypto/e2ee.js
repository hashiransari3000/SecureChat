import api from '../api/client';

const DB_NAME = 'securechat-e2ee';
const STORE = 'device-identities';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbPut(value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) binary += String.fromCharCode(...bytes.subarray(i, i + size));
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function deviceId(userId) {
  // Device IDs are account-scoped. A shared browser origin may be used to sign
  // into multiple accounts; a single global ID could otherwise collide across
  // users and make a wrapped key ambiguous.
  const storageKey = `securechat_crypto_device_id_${userId}`;
  let value = localStorage.getItem(storageKey);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(storageKey, value);
  }
  return value;
}

export async function ensureDeviceIdentity(userId) {
  if (!window.isSecureContext || !window.crypto?.subtle || !window.indexedDB) throw new Error('End-to-end encryption needs a secure browser context with Web Crypto and IndexedDB. localhost is supported.');
  const did = deviceId(userId);
  const key = `${userId}:${did}`;
  let record = await idbGet(key);
  if (!record?.privateKey || !record?.publicKey) {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      false,
      ['encrypt', 'decrypt'],
    );
    record = { key, deviceId: did, privateKey: pair.privateKey, publicKey: pair.publicKey, createdAt: new Date().toISOString() };
    await idbPut(record);
  }
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', record.publicKey);
  const { data } = await api.post('/crypto/devices', { deviceId: did, publicKeyJwk });
  const fallbackIdentities = [];
  const legacyDid = localStorage.getItem('securechat_crypto_device_id');
  if (legacyDid && legacyDid !== did) {
    const legacyRecord = await idbGet(`${userId}:${legacyDid}`).catch(() => null);
    if (legacyRecord?.privateKey) fallbackIdentities.push({ deviceId: legacyDid, privateKey: legacyRecord.privateKey, userId: String(userId) });
  }
  return { ...record, userId: String(userId), publicKeyJwk, fingerprint: data.device.fingerprint, fallbackIdentities };
}

async function importPublic(jwk) {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
}

function flattenDevices(result) {
  return (result?.participants || []).flatMap((participant) => (participant.devices || []).map((device) => ({ ...device, userId: participant.userId })));
}

export async function deleteDeviceIdentity(userId) {
  const ids = new Set();
  const scopedKey = `securechat_crypto_device_id_${userId}`;
  const scoped = localStorage.getItem(scopedKey);
  const legacy = localStorage.getItem('securechat_crypto_device_id');
  if (scoped) ids.add(scoped);
  if (legacy) ids.add(legacy);
  for (const did of ids) await idbDelete(`${userId}:${did}`).catch(() => {});
  localStorage.removeItem(scopedKey);
}

export async function recipientsForConversation(conversationId) {
  const { data } = await api.get(`/crypto/conversations/${conversationId}/recipients`);
  if (data.missingUserIds?.length) throw new Error('A member has not opened the updated SecureChat on an encryption-capable browser yet. No message was sent.');
  return flattenDevices(data);
}

export async function recipientsForUser(userId) {
  const { data } = await api.get(`/crypto/users/${userId}/recipients`);
  if (data.missingUserIds?.length) throw new Error('Both accounts need an active encrypted browser device before a private request can be sent.');
  return flattenDevices(data);
}

async function encryptWithKey(payload, devices, attachmentBytes = null) {
  if (!devices?.length) throw new Error('No encrypted recipient devices are available.');
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const rawKey = await crypto.subtle.exportKey('raw', aesKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);

  const wrappedKeys = [];
  const seen = new Set();
  for (const device of devices) {
    const recipientKey = `${device.userId}:${device.deviceId}`;
    if (seen.has(recipientKey)) continue;
    seen.add(recipientKey);
    const publicKey = await importPublic(device.publicKeyJwk);
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey);
    wrappedKeys.push({ userId: String(device.userId), deviceId: device.deviceId, wrappedKey: bytesToBase64(wrapped) });
  }

  let encryptedAttachment = null;
  if (attachmentBytes) {
    const attachmentIv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedBytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: attachmentIv }, aesKey, attachmentBytes);
    encryptedAttachment = { bytes: encryptedBytes, iv: bytesToBase64(attachmentIv) };
  }
  return {
    envelope: { e2eeVersion: 1, ciphertext: bytesToBase64(ciphertext), iv: bytesToBase64(iv), wrappedKeys, contentKind: payload.kind || 'text' },
    encryptedAttachment,
  };
}

export async function encryptPayload(payload, devices) {
  return (await encryptWithKey(payload, devices)).envelope;
}

export async function encryptPayloadWithAttachment({ payload, fileBytes, devices, conversationId }) {
  const { envelope, encryptedAttachment } = await encryptWithKey(payload, devices, fileBytes);
  const form = new FormData();
  form.append('conversationId', conversationId);
  form.append('encryptedFile', new Blob([encryptedAttachment.bytes], { type: 'application/octet-stream' }), 'encrypted.bin');
  const { data } = await api.post('/attachments', form);
  envelope.attachment = { attachmentId: data.attachmentId, encryptedSize: data.encryptedSize, iv: encryptedAttachment.iv };
  return envelope;
}

async function unwrapMessageKey(message, identity) {
  if (Number(message?.e2eeVersion) !== 1) return null;
  const identities = [identity, ...(identity.fallbackIdentities || [])];
  const matchedIdentity = identities.find((candidate) => (message.wrappedKeys || []).some((item) => item.deviceId === candidate.deviceId && (!item.userId || String(item.userId) === String(candidate.userId))));
  const wrapped = matchedIdentity && (message.wrappedKeys || []).find((item) => item.deviceId === matchedIdentity.deviceId && (!item.userId || String(item.userId) === String(matchedIdentity.userId)));
  if (!wrapped) throw new Error('This message was encrypted for another SecureChat device.');
  const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, matchedIdentity.privateKey, base64ToBytes(wrapped.wrappedKey));
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
}

export async function decryptPayload(message, identity) {
  if (Number(message?.e2eeVersion) !== 1) return { kind: message?.contentKind || 'text', text: message?.text || '', legacy: true };
  const aesKey = await unwrapMessageKey(message, identity);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(message.iv) }, aesKey, base64ToBytes(message.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function decryptAttachment(message, identity) {
  if (!message?.attachment?.attachmentId || !message?.attachment?.iv) throw new Error('Encrypted attachment reference is missing.');
  const aesKey = await unwrapMessageKey(message, identity);
  const { data } = await api.get(`/attachments/${message.attachment.attachmentId}`, { responseType: 'arraybuffer' });
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(message.attachment.iv) }, aesKey, data);
}

export async function sanitizeImageForSharing(file) {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return { file, metadataStripped: false };
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.drawImage(bitmap, 0, 0); bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!blob) return { file, metadataStripped: false };
    const safeName = `${file.name.replace(/\.[^.]+$/, '') || 'image'}.webp`;
    return { file: new File([blob], safeName, { type: 'image/webp', lastModified: Date.now() }), metadataStripped: true };
  } catch {
    return { file, metadataStripped: false };
  }
}
