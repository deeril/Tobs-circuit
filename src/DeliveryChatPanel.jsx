import React, { useEffect, useRef, useState } from 'react';
import { io as createSocketClient } from 'socket.io-client';
import DispatchCallControls from './DispatchCallControls.jsx';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const SOCKET_BASE_URL = import.meta.env.VITE_SOCKET_URL
  || (import.meta.env.DEV ? API_BASE_URL || window.location.origin : '');

export default function DeliveryChatPanel({ deliveryId, currentUserId, request }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const pendingMessageRef = useRef(null);

  useEffect(() => {
    pendingMessageRef.current = null;
  }, [deliveryId]);

  useEffect(() => {
    if (!open || !deliveryId) return undefined;
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const { messages: latestMessages } = await request(
          `/api/dispatch/deliveries/${encodeURIComponent(deliveryId)}/messages`
        );
        if (active) {
          setMessages(latestMessages);
          setError('');
        }
      } catch (requestError) {
        console.error('Could not refresh delivery chat:', requestError);
        if (active) setError(`Chat could not be refreshed: ${requestError.message}`);
      } finally {
        refreshing = false;
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
      if (message?.delivery_id === deliveryId) refresh();
    };
    socket.on('dispatch:message', refreshForMessage);
    socket.on('connect', refresh);
    return () => {
      active = false;
      window.clearInterval(timerId);
      socket.disconnect();
    };
  }, [deliveryId, open, request]);

  useEffect(() => {
    if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  const send = async event => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError('');
    if (!pendingMessageRef.current || pendingMessageRef.current.body !== message) {
      pendingMessageRef.current = { id: crypto.randomUUID(), body: message };
    }
    try {
      const { message: sentMessage } = await request(
        `/api/dispatch/deliveries/${encodeURIComponent(deliveryId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({ message, clientMessageId: pendingMessageRef.current.id })
        }
      );
      setMessages(previous => previous.some(item => item.message_id === sentMessage.message_id)
        ? previous
        : [...previous, sentMessage]);
      setDraft('');
      pendingMessageRef.current = null;
    } catch (requestError) {
      console.error('Could not send delivery chat message:', requestError);
      setError(`Message was not sent: ${requestError.message}`);
    } finally {
      setSending(false);
    }
  };

  if (!deliveryId) return null;
  const unreadCount = messages.filter(message =>
    message.sender_id !== currentUserId && !message.read_at
  ).length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(previous => !previous)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-xs font-extrabold text-slate-900">Delivery chat</span>
        <span className="rounded-full bg-violet-100 px-2 py-1 text-[9px] font-bold text-violet-800">
          {unreadCount ? `${unreadCount} unread` : open ? 'Close' : 'Open'}
        </span>
      </button>
      {open && (
        <>
          <DispatchCallControls
            deliveryId={deliveryId}
            currentUserId={currentUserId}
            request={request}
          />
          <div
            ref={listRef}
            aria-live="polite"
            className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-2"
          >
            {messages.length === 0 && (
              <p className="py-4 text-center text-[10px] text-slate-500">No messages yet.</p>
            )}
            {messages.map(message => {
              const ownMessage = message.sender_id === currentUserId;
              return (
                <article
                  key={message.message_id}
                  className={`max-w-[90%] rounded-xl px-2.5 py-2 ${
                    ownMessage ? 'ml-auto bg-violet-700 text-white' : 'bg-white text-slate-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words text-[10px]">{message.body}</p>
                  <p className={`mt-1 text-right text-[8px] ${ownMessage ? 'text-violet-100' : 'text-slate-400'}`}>
                    {new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {ownMessage ? ` · ${message.read_at ? 'Read' : message.delivered_at ? 'Delivered' : 'Sent'}` : ''}
                  </p>
                </article>
              );
            })}
          </div>
          {error && <p role="alert" className="mt-2 text-[9px] text-rose-700">{error}</p>}
          <form onSubmit={send} className="mt-2 flex gap-2">
            <input
              aria-label="Message"
              maxLength={2000}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              placeholder="Send a delivery update"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-2 text-[10px] text-slate-900"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="rounded-lg bg-violet-700 px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"
            >
              {sending ? 'Sending' : 'Send'}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
