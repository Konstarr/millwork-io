import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
const EMPTY = {
  name: '',
  customer_id: '',
  status: 'draft',
  bid_due: '',
  location: '',
  scope_summary: '',
  notes: '',
};

const STATUSES = ['draft', 'bidding', 'awarded', 'in-progress', 'complete', 'lost'];

export default function ProjectDetail() {
  const { id }        = useParams();
  const isNew         = id === 'new';
  const nav           = useNavigate();

  const [form, setForm]         = useState(EMPTY);
  const [customers, setCustomers] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading]   = useState(!isNew);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');
  const [msg, setMsg]           = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await supabase.from('customers').select('id, name').order('name');
      if (!cancelled) setCustomers(c.data || []);

      if (isNew) { setLoading(false); return; }
      const [p, es] = await Promise.all([
        supabase.from('projects').select('*').eq('id', id).maybeSingle(),
        supabase.from('estimates').select('id, name, status, total_amount, updated_at').eq('project_id', id).order('updated_at', { ascending: false }),
      ]);
      if (cancelled) return;
      if (p.error) setErr(p.error.message);
      setForm({ ...EMPTY, ...(p.data || {}), bid_due: p.data?.bid_due?.slice(0, 10) || '' });
      setEstimates(es.data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, isNew]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setErr(''); setMsg('');
    const payload = {
      ...form,
      bid_due: form.bid_due || null,
      customer_id: form.customer_id || null,
    };
    if (isNew) {
      const { data, error } = await supabase
        .from('projects').insert(payload)
        .select('id').single();
      setSaving(false);
      if (error) { setErr(error.message); return; }
      nav(`/projects/${data.id}`, { replace: true });
      return;
    }
    const { error } = await supabase.from('projects').update(payload).eq('id', id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setMsg('Saved.');
  };

  const remove = async () => {
    if (!confirm('Delete this project and all of its estimates?')) return;
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    nav('/projects', { replace: true });
  };

  if (loading) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>{isNew ? 'New project' : form.name || 'Project'}</h1>
          <p><Link to="/projects">← All projects</Link></p>
        </div>
        {!isNew && (
          <div className="page-head-actions">
            <Link to={`/estimates/new?project=${id}`} className="btn primary">+ New estimate</Link>
            <button className="btn ghost" onClick={remove}>Delete</button>
          </div>
        )}
      </div>

      <form onSubmit={save} className="panel">
        <div className="form-grid">
          <label className="full">Project name
            <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label>Customer
            <select value={form.customer_id || ''} onChange={(e) => set('customer_id', e.target.value)}>
              <option value="">— none —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Status
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Bid due
            <input type="date" value={form.bid_due || ''} onChange={(e) => set('bid_due', e.target.value)} />
          </label>
          <label>Location
            <input value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Job site city, state" />
          </label>
          <label className="full">Scope summary
            <textarea rows={3} value={form.scope_summary} onChange={(e) => set('scope_summary', e.target.value)} placeholder="Casework, millwork, doors, etc." />
          </label>
          <label className="full">Notes
            <textarea rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>

        {err && <div className="auth-err" style={{ marginTop: 12 }}>{err}</div>}
        {msg && <div className="auth-note" style={{ marginTop: 12 }}>{msg}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : (isNew ? 'Create project' : 'Save changes')}
          </button>
        </div>
      </form>

      {!isNew && (
        <div className="panel" style={{ marginTop: 20 }}>
          <h2 style={{ marginBottom: 10 }}>Estimates</h2>
          {estimates.length === 0 ? (
            <div className="empty">No estimates yet. <Link to={`/estimates/new?project=${id}`}>Create the first one →</Link></div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Estimate</th>
                    <th>Status</th>
                    <th className="right">Total</th>
                    <th className="right">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {estimates.map((e) => (
                    <tr key={e.id}>
                      <td><Link to={`/estimates/${e.id}`}>{e.name || 'Untitled estimate'}</Link></td>
                      <td><span className="pill">{e.status || 'draft'}</span></td>
                      <td className="right money">{Number(e.total_amount || 0).toFixed(2)}</td>
                      <td className="right muted">{e.updated_at ? new Date(e.updated_at).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
