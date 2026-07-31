import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, isConfigured } from '../lib/supabase.js';

export default function Signup() {
  const [email, setEmail]   = useState('');
  const [password, setPass] = useState('');
  const [err, setErr]       = useState('');
  const [msg, setMsg]       = useState('');
  const [busy, setBusy]     = useState(false);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(''); setMsg('');
    const { data, error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    // If email confirmations are off, session is returned immediately.
    if (data.session) nav('/onboarding', { replace: true });
    else setMsg('Check your inbox to confirm your email, then come back and sign in.');
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1 className="auth-brand">millwork.io</h1>
        <p className="auth-sub">Create your account</p>
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
            <input type="password" required minLength={8} value={password} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
          </label>
          {err && <div className="auth-err">{err}</div>}
          {msg && <div className="auth-note">{msg}</div>}
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
        <div className="auth-foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
