import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarClock, RefreshCw, TicketCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

interface Ticket {
  id: string;
  customerName: string;
  customerEmail: string | null;
  subject: string;
  description: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  followUpAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const ticketStatuses: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting: 'Waiting for Response',
  resolved: 'Resolved',
  closed: 'Closed'
};

const activeStatuses = new Set(['open', 'in_progress', 'waiting']);

function isOverdue(ticket: Ticket, now: number): boolean {
  if (!ticket.followUpAt || now === 0 || !activeStatuses.has(ticket.status)) return false;
  const [year, month, day] = ticket.followUpAt.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return false;
  const followUpDay = new Date(year, month - 1, day).getTime();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return followUpDay < today.getTime();
}

export const AgentWorkQueue: React.FC = () => {
  const { token, user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTicketId, setSavingTicketId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState<'earliest' | 'latest'>('earliest');
  const [now, setNow] = useState(0);

  const fetchTickets = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch('/api/tickets', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load your work queue.');
      setTickets(data.tickets || []);
      setNow(Date.now());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load your work queue.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchTickets(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchTickets]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const updateTicket = async (ticket: Ticket, updates: Partial<Pick<Ticket, 'status' | 'priority' | 'followUpAt' | 'assignedTo'>>) => {
    setSavingTicketId(ticket.id);
    setError('');
    try {
      const response = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to update this ticket.');
      setTickets(current => current.map(item => item.id === ticket.id ? data.ticket : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this ticket.');
      if (updates.assignedTo) void fetchTickets();
    } finally {
      setSavingTicketId(null);
    }
  };

  const visibleTickets = useMemo(() => {
    return tickets
      .filter(ticket => priorityFilter === 'all' || ticket.priority === priorityFilter)
      .filter(ticket => statusFilter === 'all' || ticket.status === statusFilter)
      .sort((a, b) => {
        if (!a.followUpAt && !b.followUpAt) return 0;
        if (!a.followUpAt) return 1;
        if (!b.followUpAt) return -1;
        const order = new Date(a.followUpAt).getTime() - new Date(b.followUpAt).getTime();
        return sortOrder === 'earliest' ? order : -order;
      });
  }, [tickets, priorityFilter, statusFilter, sortOrder]);

  const assignedTickets = visibleTickets.filter(ticket => ticket.assignedTo === user?.id);
  const unassignedTickets = visibleTickets.filter(ticket => !ticket.assignedTo);
  const overdueTickets = visibleTickets.filter(ticket => isOverdue(ticket, now));

  const renderTicket = (ticket: Ticket, canEdit: boolean) => {
    const ticketIsOverdue = isOverdue(ticket, now);
    const saving = savingTicketId === ticket.id;
    return (
      <article key={ticket.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900">{ticket.subject}</h3>
            <p className="mt-1 text-xs font-medium text-slate-700">
              {ticket.customerName}{ticket.customerEmail ? ` · ${ticket.customerEmail}` : ''}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{ticket.description}</p>
          </div>
          {!ticket.assignedTo && (
            <button
              type="button"
              disabled={saving || !user?.id || !activeStatuses.has(ticket.status)}
              onClick={() => user?.id && void updateTicket(ticket, { assignedTo: user.id })}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <TicketCheck className="h-4 w-4" /> {saving ? 'Claiming…' : activeStatuses.has(ticket.status) ? 'Claim issue' : 'Cannot claim'}
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <label className="space-y-1 text-[11px] font-semibold text-slate-500">
            Priority
            <select
              aria-label={`Priority for ${ticket.subject}`}
              disabled={!canEdit || saving}
              value={ticket.priority}
              onChange={event => void updateTicket(ticket, { priority: event.target.value })}
              className="block rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 disabled:bg-slate-50"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="space-y-1 text-[11px] font-semibold text-slate-500">
            Status
            <select
              aria-label={`Status for ${ticket.subject}`}
              disabled={!canEdit || saving}
              value={ticket.status}
              onChange={event => void updateTicket(ticket, { status: event.target.value })}
              className="block rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 disabled:bg-slate-50"
            >
              {Object.entries(ticketStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-[11px] font-semibold text-slate-500">
            Follow-up
            <input
              aria-label={`Follow-up date for ${ticket.subject}`}
              type="date"
              disabled={!canEdit || saving}
              value={ticket.followUpAt ? new Date(ticket.followUpAt).toISOString().slice(0, 10) : ''}
              onChange={event => void updateTicket(ticket, {
                followUpAt: event.target.value ? new Date(`${event.target.value}T12:00:00`).toISOString() : null
              })}
              className="block rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 disabled:bg-slate-50"
            />
          </label>
          <div className={`ml-auto inline-flex items-center gap-1.5 text-xs ${ticketIsOverdue ? 'font-bold text-red-600' : 'text-slate-500'}`}>
            <CalendarClock className="h-4 w-4" />
            {ticketIsOverdue ? 'Overdue · ' : ''}
            {ticket.followUpAt ? new Date(ticket.followUpAt).toLocaleDateString() : 'No follow-up set'}
          </div>
        </div>
      </article>
    );
  };

  const renderSection = (title: string, description: string, sectionTickets: Ticket[], canEdit: boolean) => (
    <section key={title} className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{sectionTickets.length}</span>
      </div>
      {sectionTickets.length === 0
        ? <p className="rounded-xl border border-dashed border-slate-200 bg-white p-5 text-center text-xs text-slate-500">No issues in this section.</p>
        : <div className="space-y-3">{sectionTickets.map(ticket => renderTicket(ticket, canEdit && ticket.assignedTo === user?.id))}</div>}
    </section>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900">Agent Work Queue</h2>
          <p className="mt-1 text-xs text-slate-500">Manage your assigned issues, claim unassigned work, and track follow-ups.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void fetchTickets();
          }}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      {error && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="h-4 w-4" />{error}</div>}

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Priority
          <select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Status
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="all">All statuses</option>
            {Object.entries(ticketStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Follow-up date
          <select value={sortOrder} onChange={event => setSortOrder(event.target.value as 'earliest' | 'latest')} className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="earliest">Soonest first</option><option value="latest">Latest first</option>
          </select>
        </label>
      </div>

      {loading && tickets.length === 0
        ? <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading your work queue…</p>
        : <div className="space-y-7">
          {renderSection('Overdue', 'Past-due follow-ups that are still open.', overdueTickets, true)}
          {renderSection('Assigned to Me', 'Issues currently assigned to your account.', assignedTickets, true)}
          {renderSection('Unassigned', 'Claim an issue to take ownership and update it.', unassignedTickets, false)}
        </div>}
    </div>
  );
};
