import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from './useSocket';

const CallContext = createContext(null);

const RTC_CONFIG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

function idOf(value) { return String(value?._id || value?.id || value || ''); }

// Minimal ringtone synthesized with Web Audio (no bundled audio assets).
function startRingtone() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);
    let step = 0;
    const pattern = [ [880, 0.5], [0, 0.2], [1120, 0.5], [0, 0.3] ];
    const timer = ctx.createOscillator ? window.setInterval(() => {
      const [freq, dur] = pattern[step % pattern.length];
      step += 1;
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, ctx.currentTime);
      envelope.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(envelope); envelope.connect(gain);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
    }, 500) : null;
    return () => {
      if (timer) window.clearInterval(timer);
      ctx.close().catch(() => {});
    };
  } catch { return () => {}; }
}

export function CallProvider({ children }) {
  const socket = useSocket();
  const [call, setCall] = useState({ status: 'idle', kind: 'audio' });
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const callRef = useRef(call);
  const stopRingRef = useRef(null);
  const ringingTimerRef = useRef(null);
  const wakeLockRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const pendingSignalsRef = useRef([]);

  useEffect(() => { callRef.current = call; }, [call]);

  const requestWakeLock = useCallback(async () => {
    try {
      if (navigator.wakeLock?.request) wakeLockRef.current = await navigator.wakeLock.request('screen');
    } catch { /* not available / denied */ }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release?.().catch(() => {}); wakeLockRef.current = null;
  }, []);

  const cleanup = useCallback((next = callRef.current) => {
    pcRef.current?.getSenders?.()?.forEach?.((s) => s.track?.stop?.());
    localStreamRef.current?.getTracks?.().forEach?.((t) => t.stop());
    pcRef.current?.close?.(); pcRef.current = null;
    localStreamRef.current = null; remoteStreamRef.current = null;
    setLocalStream(null); setRemoteStream(null);
    if (stopRingRef.current) { stopRingRef.current(); stopRingRef.current = null; }
    if (ringingTimerRef.current) { window.clearTimeout(ringingTimerRef.current); ringingTimerRef.current = null; }
    releaseWakeLock();
    pendingCandidatesRef.current = [];
    if (next?.status === 'active' || next?.status === 'outgoing' || next?.status === 'ringing') {
      setCall({ status: 'idle', kind: next.kind || 'audio' });
    }
  }, [releaseWakeLock]);

  useEffect(() => () => cleanup({ status: 'idle' }), [cleanup]);

  // A shared helper used by both the caller (after call:accepted) and the
  // callee (after the user taps Answer). isCaller=true creates the offer.
  const initializeCall = useCallback(async (kind, isCaller) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false });
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc; localStreamRef.current = stream; setLocalStream(stream);
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    // Flush any signaling that arrived before this PC existed.
    if (callRef.current.status === 'ringing') { // callee: consume queued offer/candidates
      for (const queued of pendingSignalsRef.current.splice(0)) {
        try {
          if (queued.signal?.type === 'offer') {
            await pc.setRemoteDescription(queued.signal);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket?.emit('call:signal', { conversationId: callRef.current.conversationId, to: queued.from, signal: pc.localDescription });
          } else if (queued.signal?.type === 'candidate') {
            pendingCandidatesRef.current.push(queued.signal.candidate);
          }
        } catch { /* ignore */ }
      }
    }
    const flushCandidates = async () => {
      const queued = pendingCandidatesRef.current.splice(0);
      for (const candidate of queued) { try { await pc.addIceCandidate(candidate); } catch { /* stale candidate */ } }
    };
    await flushCandidates();
    pc.onicecandidate = (event) => {
      if (!event.candidate || !callRef.current.conversationId || !socket) return;
      const otherId = callRef.current.peerId;
      socket.emit('call:signal', { conversationId: callRef.current.conversationId, to: otherId, signal: { type: 'candidate', candidate: event.candidate.toJSON() } });
    };
    pc.ontrack = (event) => { const s = event.streams?.[0] || remoteStreamRef.current; remoteStreamRef.current = s; setRemoteStream(s); };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected' && (callRef.current.status === 'ringing' || callRef.current.status === 'outgoing')) setCall({ ...callRef.current, status: 'active' });
      if (state === 'failed' || state === 'disconnected') { if (state === 'failed') cleanup(); else if (callRef.current.status === 'active') setCall({ ...callRef.current, status: 'ended', reason: 'connection-lost' }); }
    };
    await requestWakeLock();
    if (isCaller) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket?.emit('call:signal', { conversationId: callRef.current.conversationId, to: callRef.current.peerId, signal: pc.localDescription });
    }
  }, [socket, requestWakeLock, cleanup]);

  // ---- Signaling handlers -------------------------------------------------
  useEffect(() => {
    if (!socket) return undefined;
    const accepted = ({ conversationId, kind = 'audio' }) => {
      if (String(conversationId) !== String(callRef.current.conversationId)) return;
      if (stopRingRef.current) { stopRingRef.current(); stopRingRef.current = null; }
      initializeCall(kind === 'video' ? 'video' : 'audio', true).catch((err) => { cleanup(); window.dispatchEvent(new CustomEvent('securechat:toast', { detail: err?.message || 'Cannot connect to your camera/microphone.' })); });
    };
    const incoming = ({ conversationId, caller, kind = 'audio' }) => {
      if (callRef.current.status === 'outgoing' || callRef.current.status === 'ringing' || callRef.current.status === 'active') {
        // Already in a call: automatically decline.
        socket.emit('call:reject', { conversationId, reason: 'busy' });
        return;
      }
      setCall({ status: 'incoming', conversationId: String(conversationId), caller, kind: kind === 'video' ? 'video' : 'audio' });
      stopRingRef.current = startRingtone();
    };
    const ended = ({ conversationId } = {}) => {
      if (String(conversationId) !== String(callRef.current.conversationId)) return;
      const wasActive = callRef.current.status === 'active' || callRef.current.status === 'ringing';
      cleanup({ status: wasActive ? 'active' : callRef.current.status, kind: callRef.current.kind });
      if (wasActive) {
        setCall({ status: 'ended', kind: callRef.current.kind, reason: 'remote-ended' });
        window.setTimeout(() => setCall((prev) => prev.status === 'ended' ? { status: 'idle', kind: prev.kind } : prev), 1600);
      }
    };
    const rejected = ({ conversationId }) => {
      if (String(conversationId) !== String(callRef.current.conversationId)) return;
      if (callRef.current.status === 'outgoing') { cleanup({ status: 'active', kind: callRef.current.kind }); setCall({ status: 'ended', kind: callRef.current.kind, reason: 'declined' }); window.setTimeout(() => setCall((prev) => prev.status === 'ended' ? { status: 'idle', kind: prev.kind } : prev), 1800); }
    };
    const cancelled = ({ conversationId }) => {
      if (callRef.current.status === 'incoming' && String(conversationId) === String(callRef.current.conversationId)) {
        cleanup(); setCall({ status: 'idle', kind: callRef.current.kind });
      }
    };
    const signal = async ({ conversationId, from, signal }) => {
      if (String(conversationId) !== String(callRef.current.conversationId)) return;
      const pc = pcRef.current;
      if (!pc) { pendingSignalsRef.current.push({ from, signal }); return; }
      try {
        const flushCandidates = async () => {
          const queued = pendingCandidatesRef.current.splice(0);
          for (const candidate of queued) { try { await pc.addIceCandidate(candidate); } catch { /* stale candidate */ } }
        };
        if (signal?.type === 'offer') {
          pendingCandidatesRef.current = [];
          await pc.setRemoteDescription(signal);
          await flushCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('call:signal', { conversationId, to: from, signal: pc.localDescription });
        } else if (signal?.type === 'answer') {
          await pc.setRemoteDescription(signal);
          await flushCandidates();
        } else if (signal?.type === 'candidate') {
          if (!signal.candidate) return;
          if (pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(signal.candidate);
          else pendingCandidatesRef.current.push(signal.candidate);
        }
      } catch { /* ignore malformed signals */ }
    };
    socket.on('call:accepted', accepted);
    socket.on('call:incoming', incoming);
    socket.on('call:ended', ended);
    socket.on('call:rejected', rejected);
    socket.on('call:cancelled', cancelled);
    socket.on('call:signal', signal);
    return () => {
      socket.off('call:accepted', accepted);
      socket.off('call:incoming', incoming);
      socket.off('call:ended', ended);
      socket.off('call:rejected', rejected);
      socket.off('call:cancelled', cancelled);
      socket.off('call:signal', signal);
    };
  }, [socket, cleanup, initializeCall]);

  const startCall = useCallback(async ({ conversationId, peer, kind = 'audio' }) => {
    if (!socket || !conversationId || !peer) return;
    // Late bound so the object isn't created before this callback runs.
    setCall({ status: 'outgoing', conversationId: String(conversationId), peerId: idOf(peer), peer: { name: peer.name || peer.username || 'SecureChat user', username: peer.username || '', avatarUrl: peer.avatarUrl || '' }, kind: kind === 'video' ? 'video' : 'audio' });
    socket.emit('call:invite', { conversationId: String(conversationId), kind: kind === 'video' ? 'video' : 'audio' }, (result) => {
      if (result?.ok) {
        stopRingRef.current = startRingtone();
        ringingTimerRef.current = window.setTimeout(() => { if (callRef.current.status === 'outgoing') { socket.emit('call:cancel', { conversationId: String(conversationId) }); cleanup(); setCall({ status: 'idle', kind: callRef.current.kind }); window.dispatchEvent(new CustomEvent('securechat:toast', { detail: 'No answer. The call ended.' })); } }, 40000);
      } else {
        const error = result?.error || 'offline';
        setCall({ status: 'idle', kind });
        window.dispatchEvent(new CustomEvent('securechat:toast', { detail: error === 'busy' ? 'The person is on another call.' : error === 'offline' ? 'The person is not online right now.' : error }));
      }
    });
  }, [socket, cleanup]);

  const acceptCall = useCallback(async () => {
    const current = callRef.current;
    if (current.status !== 'incoming' || !socket) return;
    if (stopRingRef.current) { stopRingRef.current(); stopRingRef.current = null; }
    setCall({ ...current, status: 'ringing', peerId: idOf(current.caller), peer: { name: current.caller?.name, username: current.caller?.username, avatarUrl: current.caller?.avatarUrl } });
    socket.emit('call:accept', { conversationId: current.conversationId });
    try {
      await initializeCall(current.kind, false);
    } catch (err) {
      cleanup();
      socket.emit('call:reject', { conversationId: current.conversationId, reason: 'declined' });
      window.dispatchEvent(new CustomEvent('securechat:toast', { detail: err?.message || 'Cannot access your camera or microphone.' }));
    }
  }, [socket, cleanup, initializeCall]);

  const declineCall = useCallback(() => {
    const current = callRef.current;
    if (current.status === 'incoming' && socket) socket.emit('call:reject', { conversationId: current.conversationId });
    cleanup();
    setCall({ status: 'idle', kind: current.kind });
  }, [socket, cleanup]);

  const endCall = useCallback(() => {
    const current = callRef.current;
    if (socket && current.conversationId && (current.status === 'active' || current.status === 'ringing' || current.status === 'outgoing')) socket.emit('call:end', { conversationId: current.conversationId });
    cleanup();
    setCall({ status: 'idle', kind: current.kind });
  }, [socket, cleanup]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks?.()[0];
    if (track) setCall((prev) => {
      track.enabled = !track.enabled;
      return { ...prev, muted: !prev.muted };
    });
  }, []);

  const toggleVideo = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks?.()[0];
    if (track) setCall((prev) => {
      track.enabled = !track.enabled;
      return { ...prev, videoHidden: !prev.videoHidden };
    });
  }, []);

  const value = useMemo(() => ({ call, localStream, remoteStream, startCall, acceptCall, declineCall, endCall, toggleMute, toggleVideo }), [call, localStream, remoteStream, startCall, acceptCall, declineCall, endCall, toggleMute, toggleVideo]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  return useContext(CallContext);
}