import { useEffect, useRef, useState } from 'react';
import { io as createSocketClient } from 'socket.io-client';
import { Send } from 'lucide-react';
import DispatchCallControls from './DispatchCallControls.jsx';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const SOCKET_BASE_URL = import.meta.env.VITE_SOCKET_URL
  || (import.meta.env.DEV ? API_BASE_URL || window.location.origin : '');

export default function DirectDriverChatPanel({
  driverId,
  currentUserId,
  role,
  request
}) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  const messagesPath = role === 'DRIVER'
    ? '/api/driver/super-admin/messages'
    : `/api/super-admin/drivers/${encodeURIComponent(driverId)}/messages`;

  useEffect(() => {
    if (!driverId || !currentUserId) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const { messages: latestMessages = [] } = await request(messagesPath);
        if (active) {
          setMessages(latestMessages);
          setError('');
        }
      } catch (loadError) {
        if (active) setError(loadError.message);
      }
    };
    refresh();
    const timerId = window.setInterval(refresh, 4_000);
    const socket = createSocketClient(SOCKET_BASE_URL, {
      withCredentials: true,
      transports: ['websocket'],
      reconnection: true
    });
    const refreshForMessage = message => {
      if (message?.driver_id === driverId) refresh();
    };
    socket.on('dispatch:driver-message', refreshForMessage);
    socket.on('connect', refresh);
    return () => {
      active = false;
      window.clearInterval(timerId);
      socket.disconnect();
    };
  }, [currentUserId, driverId, messagesPath, request]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const send = async event => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const { message } = await request(messagesPath, {
        method: 'POST',
        body: JSON.stringify({ message: text, clientMessageId: crypto.randomUUID() })
      });
      setMessages(previous => previous.some(item => item.message_id === message.message_id)
        ? previous
        : [...previous, message]);
      setDraft('');
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  };

  if (!driverId) return null;
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3" aria-label="Direct rider conversation">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-extrabold text-slate-900">
          {role === 'DRIVER' ? 'Chat with Super Admin' : 'Direct rider chat'}
        </h3>
        <span className="text-[9px] font-semibold text-emerald-700">Live</span>
      </header>
      <DispatchCallControls
        supportThreadId={`driver:${driverId}`}
        currentUserId={currentUserId}
        request={request}
      />
      <div ref={listRef} aria-live="polite" className="max-h-56 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-2">
        {messages.length === 0 && (
          <p className="py-4 text-center text-[10px] text-slate-500">No messages yet.</p>
        )}
        {messages.map(message => {
          const ownMessage = message.sender_id === currentUserId;
          return (
            <article key={message.message_id} className={`max-w-[90%] rounded-xl px-2.5 py-2 ${ownMessage ? 'ml-auto bg-violet-700 text-white' : 'bg-white text-slate-800'}`}>
              <p className="whitespace-pre-wrap break-words text-[10px]">{message.body}</p>
              <p className={`mt-1 text-right text-[8px] ${ownMessage ? 'text-violet-100' : 'text-slate-400'}`}>
                {new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </article>
          );
        })}
      </div>
      {error && <p role="alert" className="text-[10px] text-rose-700">{error}</p>}
      <form onSubmit={send} className="flex gap-2">
        <input
          aria-label="Direct rider message"
          maxLength={2000}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="Write a message"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-2 text-[10px] text-slate-900"
        />
        <button type="submit" disabled={sending || !draft.trim()} className="rounded-lg bg-violet-700 px-3 py-2 text-white disabled:opacity-50" aria-label="Send rider message">
          <Send size={14} />
        </button>
      </form>
    </section>
  );
}
