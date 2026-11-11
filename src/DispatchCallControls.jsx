import { useCallback, useEffect, useRef, useState } from 'react';
import { io as createSocketClient } from 'socket.io-client';
import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const SOCKET_BASE_URL = import.meta.env.VITE_SOCKET_URL
  || (import.meta.env.DEV ? API_BASE_URL || window.location.origin : '');

function callStatusLabel(status) {
  return String(status || '').toLowerCase().replaceAll('_', ' ');
}

export default function DispatchCallControls({
  deliveryId,
  supportThreadId,
  currentUserId,
  request
}) {
  const [calls, setCalls] = useState([]);
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const socketRef = useRef(null);
  const requestRef = useRef(request);
  const peerRef = useRef(null);
  const streamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const activeCallRef = useRef(null);
  const incomingCallRef = useRef(null);
  const iceServersRef = useRef([]);
  const pendingSignalsRef = useRef([]);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  const conversationQuery = deliveryId
    ? `deliveryId=${encodeURIComponent(deliveryId)}`
    : supportThreadId
      ? `supportThreadId=${encodeURIComponent(supportThreadId)}`
      : '';
  const contextKey = deliveryId || supportThreadId;

  const cleanupMedia = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    pendingSignalsRef.current = [];
    setMuted(false);
  }, []);

  const setCurrentCall = useCallback(call => {
    activeCallRef.current = call;
    setActiveCall(call);
  }, []);

  const sendSignal = useCallback((callId, type, data) => new Promise((resolve, reject) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      reject(new Error('Live call signaling is disconnected. Reconnect and try again.'));
      return;
    }
    socket.emit('dispatch:call:signal', { callId, type, data }, result => {
      if (!result?.ok) reject(new Error(result?.error || 'Call signaling failed.'));
      else resolve();
    });
  }), []);

  const processSignal = useCallback(async signal => {
    const call = activeCallRef.current;
    if (!call || call.call_id !== signal.callId) return;
    const peer = peerRef.current;
    if (!peer) {
      pendingSignalsRef.current.push(signal);
      return;
    }
    if (signal.type === 'offer') {
      await peer.setRemoteDescription(signal.data);
      const earlyCandidates = pendingSignalsRef.current.splice(0)
        .filter(pending => pending.callId === call.call_id && pending.type === 'ice');
      for (const candidate of earlyCandidates) await peer.addIceCandidate(candidate.data);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await sendSignal(call.call_id, 'answer', peer.localDescription.toJSON());
    } else if (signal.type === 'answer') {
      await peer.setRemoteDescription(signal.data);
      const earlyCandidates = pendingSignalsRef.current.splice(0)
        .filter(pending => pending.callId === call.call_id && pending.type === 'ice');
      for (const candidate of earlyCandidates) await peer.addIceCandidate(candidate.data);
    } else if (signal.type === 'ice') {
      if (!peer.remoteDescription) pendingSignalsRef.current.push(signal);
      else await peer.addIceCandidate(signal.data);
    }
  }, [sendSignal]);

  const createPeer = useCallback(async call => {
    if (peerRef.current) return peerRef.current;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      throw new Error('This browser does not support secure audio calling.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    streamRef.current = stream;
    const peer = new RTCPeerConnection({ iceServers: iceServersRef.current });
    peerRef.current = peer;
    stream.getAudioTracks().forEach(track => peer.addTrack(track, stream));
    peer.ontrack = event => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0] || new MediaStream([event.track]);
        remoteAudioRef.current.play().catch(playError => {
          console.warn('Remote call audio requires a user gesture:', playError);
        });
      }
    };
    peer.onicecandidate = event => {
      if (event.candidate) {
        sendSignal(call.call_id, 'ice', event.candidate.toJSON()).catch(signalError => {
          console.error('Could not send an audio call candidate:', signalError);
          setError(signalError.message);
        });
      }
    };
    peer.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(peer.connectionState)) {
        setStatus(peer.connectionState === 'failed' ? 'Call connection failed' : '');
      } else if (peer.connectionState === 'connected') {
        setStatus('Connected');
      }
    };
    const queuedSignals = pendingSignalsRef.current.splice(0);
    for (const signal of queuedSignals) await processSignal(signal);
    return peer;
  }, [processSignal, sendSignal]);

  useEffect(() => {
    if (!contextKey || !conversationQuery) return undefined;
    let active = true;
    const refreshCalls = async () => {
      try {
        const { calls: latestCalls = [] } = await requestRef.current(`/api/dispatch/calls?${conversationQuery}`);
        if (!active) return;
        setCalls(latestCalls);
        const ringing = latestCalls.find(call =>
          call.status === 'RINGING' && call.recipient_id === currentUserId
        );
        const nextIncoming = ringing
          ? { ...ringing, callerName: 'Tobs Circuit user' }
          : null;
        incomingCallRef.current = nextIncoming;
        setIncomingCall(previous => previous?.call_id === ringing?.call_id
          ? previous
          : nextIncoming);
      } catch (loadError) {
        if (active) console.error('Could not load dispatch call history:', loadError);
      }
    };
    refreshCalls();
    const refreshTimer = window.setInterval(refreshCalls, 12_000);
    const socket = createSocketClient(SOCKET_BASE_URL, {
      withCredentials: true,
      transports: ['websocket'],
      reconnection: true
    });
    socketRef.current = socket;
    socket.on('dispatch:call:incoming', call => {
      const matches = deliveryId
        ? call.delivery_id === deliveryId
        : call.support_thread_id === supportThreadId;
      if (!matches || call.recipient_id !== currentUserId) return;
      incomingCallRef.current = call;
      setIncomingCall(call);
      setError('');
    });
    socket.on('dispatch:call:accepted', ({ call }) => {
      if (call.call_id !== activeCallRef.current?.call_id) return;
      setCurrentCall(call);
      setStatus('Connecting…');
      createPeer(call)
        .then(async peer => {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          await sendSignal(call.call_id, 'offer', peer.localDescription.toJSON());
        })
        .catch(callError => {
          console.error('Could not start the audio connection:', callError);
          setError(callError.message);
          setStatus('Call failed');
        });
    });
    socket.on('dispatch:call:signal', signal => {
      processSignal(signal).catch(signalError => {
        console.error('Could not apply an audio call signal:', signalError);
        setError(signalError.message);
      });
    });
    const handleCallEnd = ({ call }) => {
      const activeMatches = call?.call_id === activeCallRef.current?.call_id;
      const incomingMatches = call?.call_id === incomingCallRef.current?.call_id;
      if (!activeMatches && !incomingMatches) return;
      setStatus(callStatusLabel(call.status));
      if (activeMatches) {
        setCurrentCall(null);
        cleanupMedia();
      }
      if (incomingMatches) {
        incomingCallRef.current = null;
        setIncomingCall(null);
      }
      refreshCalls();
    };
    socket.on('dispatch:call:rejected', handleCallEnd);
    socket.on('dispatch:call:ended', handleCallEnd);
    socket.on('dispatch:call:missed', event => {
      if (event.callId === activeCallRef.current?.call_id) {
        setStatus('Missed call');
        setCurrentCall(null);
        cleanupMedia();
      }
      if (event.callId === incomingCallRef.current?.call_id) {
        incomingCallRef.current = null;
        setIncomingCall(null);
        setStatus('Missed call');
      }
      refreshCalls();
    });
    socket.on('connect', refreshCalls);
    socket.on('connect_error', socketError => {
      console.warn('Voice call signaling is disconnected:', socketError.message);
    });
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      const callToEnd = activeCallRef.current;
      if (callToEnd) {
        requestRef.current(`/api/dispatch/calls/${encodeURIComponent(callToEnd.call_id)}/end`, {
          method: 'POST',
          body: JSON.stringify({})
        }).catch(endError => {
          console.error('Could not end a call while leaving its conversation:', endError);
        });
      }
      socket.disconnect();
      socketRef.current = null;
      cleanupMedia();
    };
  }, [
    cleanupMedia,
    contextKey,
    conversationQuery,
    createPeer,
    currentUserId,
    deliveryId,
    processSignal,
    sendSignal,
    setCurrentCall,
    supportThreadId
  ]);

  const startCall = async () => {
    setError('');
    setStatus('Calling…');
    try {
      const payload = {
        ...(deliveryId ? { deliveryId } : { supportThreadId })
      };
      const { call, iceServers } = await requestRef.current('/api/dispatch/calls', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      iceServersRef.current = iceServers;
      setCurrentCall(call);
      await createPeer(call);
      setStatus('Ringing…');
      setCalls(previous => [call, ...previous.filter(item => item.call_id !== call.call_id)]);
    } catch (callError) {
      console.error('Could not start the voice call:', callError);
      cleanupMedia();
      setCurrentCall(null);
      setStatus('');
      setError(callError.message);
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    setError('');
    try {
      const { call, iceServers } = await requestRef.current(
        `/api/dispatch/calls/${encodeURIComponent(incomingCall.call_id)}/accept`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      iceServersRef.current = iceServers;
      setCurrentCall(call);
      incomingCallRef.current = null;
      setIncomingCall(null);
      setStatus('Connecting…');
      await createPeer(call);
      setCalls(previous => previous.map(item => item.call_id === call.call_id ? call : item));
    } catch (callError) {
      console.error('Could not accept the voice call:', callError);
      setError(callError.message);
    }
  };

  const rejectCall = async () => {
    if (!incomingCall) return;
    try {
      await requestRef.current(
        `/api/dispatch/calls/${encodeURIComponent(incomingCall.call_id)}/reject`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      incomingCallRef.current = null;
      setIncomingCall(null);
      setStatus('Call rejected');
    } catch (callError) {
      console.error('Could not reject the voice call:', callError);
      setError(callError.message);
    }
  };

  const endCall = async () => {
    const call = activeCallRef.current;
    if (!call) return;
    try {
      await requestRef.current(
        `/api/dispatch/calls/${encodeURIComponent(call.call_id)}/end`,
        { method: 'POST', body: JSON.stringify({}) }
      );
    } catch (callError) {
      console.error('Could not end the voice call on the server:', callError);
      setError(callError.message);
    } finally {
      setCurrentCall(null);
      cleanupMedia();
      setStatus('Call ended');
      setCalls(previous => previous.map(item => item.call_id === call.call_id
        ? { ...item, status: 'ENDED' }
        : item));
    }
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !nextMuted; });
    setMuted(nextMuted);
  };

  if (!contextKey) return null;
  return (
    <section className="mt-2 rounded-xl border border-violet-200 bg-white p-2.5" aria-label="Voice calls">
      <audio ref={remoteAudioRef} autoPlay />
      <div className="flex flex-wrap items-center gap-2">
        {!activeCall && !incomingCall && (
          <button
            type="button"
            onClick={startCall}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-2 text-[10px] font-bold text-white hover:bg-violet-800"
          >
            <Phone className="h-3.5 w-3.5" /> Voice call
          </button>
        )}
        {status && <span role="status" className="text-[10px] font-semibold text-slate-600">{status}</span>}
        {activeCall && (
          <>
            <button type="button" onClick={toggleMute} className="rounded-lg border border-slate-300 p-2" aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
              {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            </button>
            <button type="button" onClick={endCall} className="inline-flex items-center gap-1 rounded-lg bg-rose-700 px-3 py-2 text-[10px] font-bold text-white">
              <PhoneOff className="h-3.5 w-3.5" /> End call
            </button>
          </>
        )}
      </div>
      {incomingCall && !activeCall && (
        <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-violet-50 p-2">
          <span className="text-[10px] font-bold text-violet-950">Incoming call from {incomingCall.callerName || 'Tobs Circuit user'}</span>
          <span className="flex gap-1.5">
            <button type="button" onClick={acceptCall} className="rounded-md bg-emerald-700 px-2.5 py-1.5 text-[10px] font-bold text-white">Accept</button>
            <button type="button" onClick={rejectCall} className="rounded-md bg-rose-700 px-2.5 py-1.5 text-[10px] font-bold text-white">Reject</button>
          </span>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[10px] text-rose-700">{error}</p>}
      {calls.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[9px] font-semibold text-slate-500">Recent calls ({calls.length})</summary>
          <ul className="mt-1 space-y-1">
            {calls.slice(0, 5).map(call => (
              <li key={call.call_id} className="text-[9px] text-slate-600">
                {callStatusLabel(call.status)} · {new Date(call.created_at).toLocaleString()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
