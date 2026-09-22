import { useEffect, useRef, useState } from 'react';
import { useCall } from '../context/CallContext';
import Avatar from './Avatar';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, X } from 'lucide-react';

const STATUS_COPY = {
  incoming: 'Incoming call…',
  outgoing: 'Ringing…',
  ringing: 'Connecting…',
  active: '',
  ended: 'Call ended',
};

function peerOf(call) {
  if (call.status === 'incoming') return call.caller;
  return call.peer;
}

export default function CallScreen() {
  const { call, localStream, remoteStream, acceptCall, declineCall, endCall, toggleMute, toggleVideo } = useCall();
  const localRef = useRef(null);
  const remoteRef = useRef(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (localRef.current && localStream) localRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteStream) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    let timer = null;
    if (call.status === 'active') {
      setSeconds(0);
      timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => { if (timer) window.clearInterval(timer); };
  }, [call.status]);

  if (call.status === 'idle') return null;

  const peer = peerOf(call);
  const name = peer?.name || peer?.username || 'SecureChat user';
  const isVideo = call.kind === 'video';
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const endedReason = call.reason === 'declined' ? 'Call declined.' : call.reason === 'connection-lost' ? 'Connection lost.' : call.reason === 'remote-ended' ? 'Call ended.' : '';

  const avatar = { ...peer, id: peer?.id };

  return (
    <div className={`call-overlay ${call.status}`} role="dialog" aria-modal="true" aria-label={`${isVideo ? 'Video' : 'Audio'} call with ${name}`}>
      {call.status === 'active' && isVideo ? (
        <div className="call-video-stage">
          <video ref={remoteRef} className="call-remote-video" autoPlay playsInline muted={false} />
          <video ref={localRef} className="call-local-video" autoPlay playsInline muted />
          {call.videoHidden && <div className="call-video-hidden-placeholder"><VideoOff aria-hidden="true" /><span>Camera off</span></div>}
          <div className="call-video-hud">
            <strong>{name}</strong>
            <span>{duration}</span>
          </div>
        </div>
      ) : (
        <div className="call-audio-stage">
          <span className="call-avatar-frame call-pulse"><Avatar user={avatar} size="xl" /></span>
          <strong className="call-name">{name}</strong>
          <span className="call-status">{call.status === 'active' ? duration : (STATUS_COPY[call.status] || '')}</span>
          {call.status === 'ended' && endedReason && <span className="call-ended-reason">{endedReason}</span>}
          {call.videoHidden && isVideo && <span className="call-status">Camera off</span>}
        </div>
      )}

      <div className="call-controls">
        {call.status === 'incoming' && <>
          <button className="call-control call-answer" type="button" onClick={acceptCall} aria-label="Answer call" title="Answer"><Phone aria-hidden="true" /></button>
          <button className="call-control call-decline" type="button" onClick={declineCall} aria-label="Decline call" title="Decline"><PhoneOff aria-hidden="true" /></button>
        </>}
        {(call.status === 'outgoing' || call.status === 'ringing' || call.status === 'active') && <>
          {call.status === 'active' && call.muted ? <button className="call-control call-muted" type="button" onClick={toggleMute} aria-label="Unmute" title="Unmute"><MicOff aria-hidden="true" /></button> : call.status === 'active' && <button className="call-control" type="button" onClick={toggleMute} aria-label="Mute microphone" title="Mute"><Mic aria-hidden="true" /></button>}
          {isVideo && call.status === 'active' && <button className="call-control" type="button" onClick={toggleVideo} aria-label={call.videoHidden ? 'Turn camera on' : 'Turn camera off'} title={call.videoHidden ? 'Turn camera on' : 'Turn camera off'}>{call.videoHidden ? <VideoOff aria-hidden="true" /> : <Video aria-hidden="true" />}</button>}
          <button className="call-control call-decline" type="button" onClick={call.status === 'active' || call.status === 'ringing' ? endCall : endCall} aria-label="End call" title="End call"><PhoneOff aria-hidden="true" /></button>
        </>}
        {call.status === 'ended' && <><span className="call-ended-reason">{endedReason || 'Call ended.'}</span><button className="call-control call-decline" type="button" onClick={endCall} aria-label="Close" title="Close"><X aria-hidden="true" /></button></>}
      </div>
    </div>
  );
}