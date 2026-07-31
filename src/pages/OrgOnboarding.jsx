import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useOrg } from '../context/OrgContext.jsx';

function slugify(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * First-run page for a brand-new user with no org memberships.
 * Creates their company and adds them as owner via the create_org RPC
 * (see supabase/migrations/0001_init.sql).
 */
export default function OrgOnboarding() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const { refresh, setActiveOrg } = useOrg();
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('create_org', {
      name_in: name.trim(),
      slug_in: slugify(name),
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const org = Array.isArray(data) ? data[0] : data;
    await refresh();
    if (org?.id) setActiveOrg({ id: org.id, name: org.name, slug: org.slug, role: 'owner' });
    nav('/', { replace: true });
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-brand">Welcome</h1>
        <p className="auth-sub">Name your company workspace to get started.</p>
        <form onSubmit={submit} className="auth-form">
          <label>Company name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Millwork" required />
          </label>
          {err && <div className="auth-err">{err}</div>}
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </form>
      </div>
    </div>
  );
}
