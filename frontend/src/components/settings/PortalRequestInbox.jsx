import { useState } from 'react';
import api from '../../lib/api';

export default function PortalRequestInbox() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('completed');
  const [response, setResponse] = useState('');
  async function load() {
    setError(''); setBusy(true);
    try { setRows((await api.get('/portal-requests')).data.requests); }
    catch (e) { setError(e.response?.data?.detail || e.message); } finally { setBusy(false); }
  }
  async function review(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await api.patch(`/portal-requests/${encodeURIComponent(selected)}`, { status, response });
      setSelected(''); setResponse('');
      setRows((await api.get('/portal-requests')).data.requests);
    } catch (e) { setError(e.response?.data?.detail || e.message); } finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-white/10 p-5 space-y-4" aria-label="Customer portal request inbox">
    <h3 className="font-semibold">Customer requests</h3>
    <p className="text-xs text-slate-400">Managers can review the latest 100 requests for their branch. Complete a repair intake, warranty claim, or WhatsApp resend in its normal workflow before marking the request completed.</p>
    <button type="button" disabled={busy} onClick={load} className="btn-secondary">{busy ? 'Loading…' : 'Load / refresh requests'}</button>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {rows?.length === 0 && <p>No customer requests.</p>}
    {rows?.map(row => <article key={row.id} className="rounded-lg bg-black/20 p-4 space-y-2">
      <p className="font-semibold">{row.kind.replaceAll('_',' ')} · {row.status}</p>
      <p className="text-xs text-slate-400">Customer #{row.customerId} · receipt #{row.receiptSaleId}{row.relatedId ? ` · related record #${row.relatedId}` : ''}</p>
      <p className="whitespace-pre-wrap">{row.message}</p>
      {row.requestedAt && <p>Preferred time: {new Date(row.requestedAt).toLocaleString()}</p>}
      {row.staffResponse && <p className="text-cyan-300">Response: {row.staffResponse}</p>}
      {['pending','confirmed'].includes(row.status) && <button type="button" onClick={() => { setSelected(row.id); setStatus(row.kind === 'appointment' ? 'confirmed' : 'completed'); setResponse(''); }} className="btn-secondary">Review</button>}
      {selected === row.id && <form onSubmit={review} className="space-y-3">
        <label className="block">Outcome<select className="field" value={status} onChange={e => setStatus(e.target.value)}>{row.kind === 'appointment' && <option value="confirmed">Confirm appointment</option>}<option value="completed">Completed</option><option value="declined">Declined</option><option value="cancelled">Cancelled</option></select></label>
        <label className="block">Response to customer<textarea className="field w-full" required minLength={5} maxLength={2000} rows={3} value={response} onChange={e => setResponse(e.target.value)} /></label>
        <button disabled={busy || response.trim().length < 5} className="btn-primary">Save review</button>
      </form>}
    </article>)}
  </section>;
}
