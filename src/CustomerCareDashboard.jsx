import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCheck,
  CircleCheck,
  LogOut,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  UserRound
} from 'lucide-react';
import './CustomerCareDashboard.css';

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All cases' },
  { value: 'OPEN', label: 'Open' },
  { value: 'ESCALATED', label: 'Escalated' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'RESOLVED', label: 'Resolved' }
];

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function statusLabel(status) {
  return String(status || 'OPEN').replaceAll('_', ' ').toLowerCase();
}

export default function CustomerCareDashboard({ currentUser, onLogout, request }) {
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const loadThreads = async (background = false) => {
      if (background && !cancelled) setRefreshing(true);
      try {
        const { threads: nextThreads = [] } = await request('/api/super-admin/customer-care?view=threads');
        if (cancelled) return;
        setThreads(nextThreads);
        setSelectedId(previous => previous && nextThreads.some(thread => thread.id === previous)
          ? previous
          : nextThreads[0]?.id || '');
        setError('');
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    loadThreads(refreshKey > 0);
    const timerId = window.setInterval(() => loadThreads(true), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [request, refreshKey]);

  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return threads.filter(thread => {
      const matchesStatus = statusFilter === 'ALL' || thread.status === statusFilter;
      const matchesSearch = !query || [thread.caseId, thread.userName, thread.userRole]
        .some(value => String(value || '').toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [threads, statusFilter, search]);

  const selectedThread = threads.find(thread => thread.id === selectedId) || null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [selectedThread?.id, selectedThread?.messages?.length]);

  const updateThread = updatedThread => {
    setThreads(previous => [updatedThread, ...previous.filter(thread => thread.id !== updatedThread.id)]
      .sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt)));
  };

  const sendReply = async event => {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedThread || !text || sending) return;

    setSending(true);
    setError('');
    try {
      const { thread } = await request('/api/super-admin/customer-care', {
        method: 'POST',
        body: JSON.stringify({ action: 'reply', threadId: selectedThread.id, text })
      });
      updateThread(thread);
      setDraft('');
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
    }
  };

  const setThreadStatus = async status => {
    if (!selectedThread) return;
    setError('');
    try {
      const { thread } = await request('/api/super-admin/customer-care', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'status', threadId: selectedThread.id, status })
      });
      updateThread(thread);
    } catch (statusError) {
      setError(statusError.message);
    }
  };

  return (
    <main className={`cc-shell ${selectedThread ? 'is-thread-open' : ''}`}>
      <header className="cc-header">
        <div className="cc-brand">
          <span className="cc-brand-icon"><MessageSquare size={18} /></span>
          <div><strong>Customer Care</strong><small>Support inbox</small></div>
        </div>
        <div className="cc-header-actions">
          <span className="cc-agent"><UserRound size={15} />{currentUser.name}</span>
          <button type="button" className="cc-logout" onClick={onLogout} aria-label="Log out" title="Log out">
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="cc-main">
        <aside className="cc-list-panel" aria-label="Support cases">
          <div className="cc-list-heading">
            <div>
              <span className="cc-eyebrow">INBOX</span>
              <h1>Support cases</h1>
            </div>
            <button type="button" className="cc-icon-button" onClick={() => setRefreshKey(value => value + 1)} title="Refresh inbox" aria-label="Refresh inbox">
              <RefreshCw size={16} className={refreshing ? 'cc-spinning' : ''} />
            </button>
          </div>

          <label className="cc-search">
            <Search size={16} />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search cases" aria-label="Search cases" />
          </label>

          <div className="cc-filters" aria-label="Filter cases">
            {STATUS_FILTERS.map(filter => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={statusFilter === filter.value}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="cc-case-list">
            {loading ? (
              <p className="cc-empty">Loading cases…</p>
            ) : filteredThreads.length ? filteredThreads.map(thread => {
              const lastMessage = thread.messages?.[thread.messages.length - 1];
              return (
                <button
                  type="button"
                  key={thread.id}
                  className={`cc-case-row ${selectedId === thread.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedId(thread.id)}
                >
                  <span className="cc-case-avatar"><UserRound size={16} /></span>
                  <span className="cc-case-copy">
                    <span className="cc-case-top"><strong>{thread.userName || 'App user'}</strong><time>{formatTime(thread.updatedAt || thread.createdAt)}</time></span>
                    <span className="cc-case-id">{thread.caseId} · {thread.userRole || 'USER'}</span>
                    <span className="cc-case-preview">{lastMessage?.text || 'No messages yet'}</span>
                    <span className={`cc-status cc-status-${String(thread.status || 'OPEN').toLowerCase()}`}>{statusLabel(thread.status)}</span>
                  </span>
                </button>
              );
            }) : (
              <p className="cc-empty">{threads.length ? 'No cases match this filter.' : 'No support cases yet.'}</p>
            )}
          </div>
        </aside>

        <section className="cc-thread-panel" aria-label="Selected support conversation">
          {selectedThread ? (
            <>
              <div className="cc-thread-header">
                <button type="button" className="cc-back-button" onClick={() => setSelectedId('')} aria-label="Back to cases">
                  <ArrowLeft size={18} />
                </button>
                <div className="cc-thread-title">
                  <strong>{selectedThread.userName || 'App user'}</strong>
                  <small>{selectedThread.caseId} · {selectedThread.userRole || 'USER'} · Assigned to {selectedThread.assignedTo || 'Customer Care'}</small>
                </div>
                <button
                  type="button"
                  className={`cc-resolve-button ${selectedThread.status === 'RESOLVED' ? 'is-resolved' : ''}`}
                  onClick={() => setThreadStatus(selectedThread.status === 'RESOLVED' ? 'IN_PROGRESS' : 'RESOLVED')}
                >
                  {selectedThread.status === 'RESOLVED' ? <CheckCheck size={16} /> : <CircleCheck size={16} />}
                  <span>{selectedThread.status === 'RESOLVED' ? 'Reopen' : 'Resolve'}</span>
                </button>
              </div>

              <div className="cc-messages">
                <div className="cc-case-start">
                  <span>{selectedThread.caseId}</span>
                  <small>Started {formatTime(selectedThread.createdAt)}</small>
                </div>
                {(selectedThread.messages || []).map(message => {
                  const isAgent = message.sender === 'CUSTOMER_CARE';
                  const isOwner = message.sender === 'SUPER_ADMIN';
                  const isUser = message.sender === 'USER';
                  return (
                    <div className={`cc-message-row ${isUser ? 'from-user' : 'from-team'}`} key={message.id}>
                      <div className={`cc-message ${isUser ? 'is-user' : isOwner ? 'is-owner' : isAgent ? 'is-agent' : 'is-bot'}`}>
                        <span className="cc-message-sender">{isUser ? selectedThread.userName : isOwner ? message.senderName || 'Super Admin' : isAgent ? message.senderName || 'Customer Care' : 'Support bot'}</span>
                        <p>{message.text}</p>
                        <time>{formatTime(message.createdAt)}</time>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {error && <p className="cc-inline-error" role="alert">{error}</p>}
              <form className="cc-reply-form" onSubmit={sendReply}>
                <label htmlFor="cc-reply" className="sr-only">Reply to case</label>
                <textarea
                  id="cc-reply"
                  rows={2}
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  placeholder="Write a reply…"
                  maxLength={2000}
                />
                <button type="submit" disabled={!draft.trim() || sending} aria-label="Send reply" title="Send reply">
                  <Send size={17} />
                </button>
              </form>
            </>
          ) : (
            <div className="cc-no-selection">
              <span><MessageSquare size={22} /></span>
              <h2>Select a case</h2>
              <p>Choose a support case to read and reply.</p>
              {error && <p className="cc-inline-error" role="alert">{error}</p>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}