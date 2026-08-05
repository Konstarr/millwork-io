import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase.js';
const EMPTY = {
  name: '', contact_name: '', email: '', phone: '',
  address1: '', address2: '', city: '', state: '', postal_code: '',
  notes: '',
};

export default function CustomerDetail() {
  const { id }         = useParams();
  const isNew          = !id || id === 'new';
  const nav            = useNavigate();
  const [form, setForm]= useState(EMPTY);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');
  const [msg, setMsg]         = useState('');

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (cancelled) return;
      if (error) setErr(error.message);
      setForm({ ...EMPTY, ...(data || {}) });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, isNew]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setErr(''); setMsg('');
    if (isNew) {
      const { data, error } = await supabase.from('customers').insert(form).select('id').single();
      setSaving(false);
      if (error) { setErr(error.message); return; }
      nav(`/customers/${data.id}`, { replace: true });
      return;
    }
    const { error } = await supabase.from('customers').update(form).eq('id', id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setMsg('Saved.');
  };

  const remove = async () => {
    if (!confirm('Delete this customer? Any projects linked to them will keep the reference but the customer name will disappear.')) return;
    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) { setErr(error.message); return; }
    nav('/customers', { replace: true });
  };

  if (loading) return <div className="muted">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div className="page-head-title">
          <h1>{isNew ? 'New customer' : form.name || 'Customer'}</h1>
          <p><Link to="/customers">← All customers</Link></p>
        </div>
        {!isNew && (
          <div className="page-head-actions">
            <button className="btn ghost" onClick={remove}>Delete</button>
          </div>
        )}
      </div>

      <form onSubmit={save} className="panel">
        <div className="form-grid">
          <label className="full">Company name
            <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label>Primary contact
            <input value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} />
          </label>
          <label>Phone
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label className="full">Email
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </label>
          <label className="full">Address line 1
            <input value={form.address1} onChange={(e) => set('address1', e.target.value)} />
          </label>
          <label className="full">Address line 2
            <input value={form.address2} onChange={(e) => set('address2', e.target.value)} />
          </label>
          <label>City
            <input value={form.city} onChange={(e) => set('city', e.target.value)} />
          </label>
          <label>State / Postal
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ width: 60 }} value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="FL" />
              <input style={{ flex: 1 }} value={form.postal_code} onChange={(e) => set('postal_code', e.target.value)} placeholder="33101" />
            </div>
          </label>
          <label className="full">Notes
            <textarea rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>

        {err && <div className="auth-err" style={{ marginTop: 12 }}>{err}</div>}
        {msg && <div className="auth-note" style={{ marginTop: 12 }}>{msg}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : (isNew ? 'Create customer' : 'Save changes')}
          </button>
        </div>
      </form>
    </>
  );
}
