import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase, isConfigured } from '../lib/supabase.js';

export default function Login() {
  const [email, setEmail]   = useState('');
  const [password, setPass] = useState('');
  const [err, setErr]       = useState('');
  const [busy, setBusy]     = useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    nav(loc.state?.from || '/', { replace: true });
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-brand">millwork.io</h1>
        <p className="auth-sub">Sign in to your workspace</p>
        {!isConfigured && (
          <div className="auth-warn">
            Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and restart <code>npm run dev</code>.
          </div>
        )}
        <form onSubmit={submit} className="auth-form">
          <label>Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>Password
            <input type="password" required value={password} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
          </label>
          {err && <div className="auth-err">{err}</div>}
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="auth-foot">
          New here? <Link to="/signup">Create an account</Link>
        </div>
      </div>
    </div>
  );
}
