import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
import { useAuth } from '../../context/AuthContext.jsx';

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

      {!isNew && <DrawingsPanel projectId={id} />}

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

/**
 * Architectural drawings attached to this project. Binary goes to the
 * private 'drawings' storage bucket at <user_id>/<project_id>/<filename>;
 * metadata lives in public.project_files. Open uses a 1-hour signed URL.
 */
function DrawingsPanel({ projectId }) {
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [files, setFiles]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr]           = useState('');

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('project_files')
      .select('id, name, storage_path, mime_type, size_bytes, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) setErr(error.message);
    setFiles(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const onPick = async (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length || !user?.id) return;
    setUploading(true); setErr('');
    for (const f of picked) {
      // Sanitize the filename for the object key but preserve it for display.
      const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, '_');
      const path = `${user.id}/${projectId}/${Date.now()}_${safe}`;
      const up = await supabase.storage.from('drawings').upload(path, f, {
        contentType: f.type || 'application/octet-stream',
        upsert: false,
      });
      if (up.error) { setErr(`${f.name}: ${up.error.message}`); continue; }
      const ins = await supabase.from('project_files').insert({
        project_id: projectId,
        name: f.name,
        storage_path: path,
        mime_type: f.type || null,
        size_bytes: f.size,
      });
      if (ins.error) setErr(`${f.name}: ${ins.error.message}`);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    await load();
  };

  const open = async (f) => {
    const { data, error } = await supabase.storage
      .from('drawings')
      .createSignedUrl(f.storage_path, 3600);
    if (error) { setErr(error.message); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const remove = async (f) => {
    if (!confirm(`Delete ${f.name}?`)) return;
    await supabase.storage.from('drawings').remove([f.storage_path]);
    const { error } = await supabase.from('project_files').delete().eq('id', f.id);
    if (error) { setErr(error.message); return; }
    await load();
  };

  const fmtSize = (b) => {
    if (b == null) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Drawings</h2>
        <div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.dwg,.dxf"
            style={{ display: 'none' }}
            onChange={onPick}
          />
          <button className="btn primary sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '+ Upload drawings'}
          </button>
        </div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}

      {loading ? (
        <div className="muted">Loading…</div>
      ) : files.length === 0 ? (
        <div className="empty">
          No drawings yet. Upload the architectural set (PDF, images, DWG/DXF) to start takeoff.
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>File</th>
                <th style={{ width: 90 }} className="right">Size</th>
                <th style={{ width: 110 }} className="right">Uploaded</th>
                <th style={{ width: 140 }} className="right"></th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 600 }}>{f.name}</td>
                  <td className="right muted">{fmtSize(f.size_bytes)}</td>
                  <td className="right muted">{new Date(f.created_at).toLocaleDateString()}</td>
                  <td className="right">
                    {(f.mime_type === 'application/pdf' || (f.mime_type || '').startsWith('image/')) && (
                      <><Link to={`/takeoff/${f.id}`} className="btn sm primary">Takeoff →</Link>{' '}</>
                    )}
                    <button className="btn sm ghost" onClick={() => open(f)}>Open ↗</button>{' '}
                    <button className="btn sm ghost" onClick={() => remove(f)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
