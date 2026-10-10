import React, { useState } from 'react';
import { api, useApp } from '../../api.js';
import { Field } from '../../components/ui.jsx';

/** Name + role + shared PIN → token. Used by the console and inside the live alarm. */
export default function LoginForm({ compact = false }) {
  const { setSession } = useApp();
  const [name, setName] = useState('');
  const [role, setRole] = useState('operator');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setSession(await api('/ops/login', { method: 'POST', body: { name, role, pin } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`login${compact ? ' login-compact' : ''}`} onSubmit={submit}>
      {!compact && <p className="muted">Viewing is open to everyone. Changing an issue, deciding on an alarm or saving a snapshot needs a sign-in, and every change records who made it.</p>}
      <div className="form-row">
        <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} required maxLength={60} autoComplete="name" /></Field>
        <Field label="Role">
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="operator">Operator</option>
            <option value="supervisor">Supervisor</option>
          </select>
        </Field>
        <Field label="PIN"><input type="password" value={pin} onChange={e => setPin(e.target.value)} required autoComplete="current-password" inputMode="numeric" /></Field>
        <button type="submit" className="btn btn-accent" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </div>
      {error && <p className="note note-error" role="alert">{error}</p>}
    </form>
  );
}
