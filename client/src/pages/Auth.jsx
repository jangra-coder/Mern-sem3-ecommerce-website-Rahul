import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth, useToast } from '../context.jsx';
import { PrintModel } from '../components/PrintModel.jsx';
import { useTitle } from '../components/ui.jsx';

// Where to go after logging in. Only pages inside this site are allowed,
// so a crafted link can't bounce people to another website.
function useNextPath() {
  const next = useSearchParams()[0].get('next') || '/';
  try {
    // Let the browser decide where the link really points; tricks such as
    // "/%09/evil.com" or "//evil.com" resolve to another site and are refused.
    const target = new URL(next, window.location.origin);
    if (target.origin === window.location.origin) return target.pathname + target.search + target.hash;
  } catch {
    /* not a valid address */
  }
  return '/';
}

export function PasswordInput({ value, onChange, autoComplete, minLength = 1, label = 'Password', name = 'password' }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="pw">
        <input type={visible ? 'text' : 'password'} name={name} value={value} onChange={onChange} required minLength={minLength} maxLength={72} autoComplete={autoComplete} />
        <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? 'Hide' : 'Show'}</button>
      </div>
    </label>
  );
}

export function PasswordRules({ password }) {
  const rules = [
    ['8+ characters', password.length >= 8],
    ['a letter', /[A-Za-z]/.test(password)],
    ['a number', /\d/.test(password)],
  ];
  return (
    <ul className="rules" aria-label="Password rules">
      {rules.map(([text, ok]) => <li key={text} className={ok ? 'ok' : ''}>{text}</li>)}
    </ul>
  );
}

function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const { user, loading, login, register } = useAuth();
  const toast = useToast();
  const next = useNextPath();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useTitle(isRegister ? 'Create account' : 'Log in');

  if (!loading && user) return <Navigate to={next} replace />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isRegister) {
        await register(form.name, form.email, form.password);
        toast(`Welcome, ${form.name.trim().split(' ')[0]}!`);
      } else {
        await login(form.email, form.password);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const query = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;

  return (
    <div className="auth">
      <div className="auth-form">
        <form className="form" onSubmit={handleSubmit} noValidate={false}>
          <p className="eyebrow">{isRegister ? 'New here' : 'Welcome back'}</p>
          <h1>{isRegister ? 'Create an account' : 'Log in'}</h1>
          {error && <p className="alert alert--bad" role="alert">{error}</p>}
          {isRegister && (
            <label className="field">
              <span>Your name</span>
              <input name="name" value={form.name} onChange={set('name')} required minLength={2} maxLength={50} autoComplete="name" />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" value={form.email} onChange={set('email')} required maxLength={254} autoComplete="email" />
          </label>
          <PasswordInput value={form.password} onChange={set('password')} minLength={isRegister ? 8 : 1} autoComplete={isRegister ? 'new-password' : 'current-password'} />
          {isRegister && <PasswordRules password={form.password} />}
          <button className="btn btn--hot btn--block" disabled={busy}>
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}
          </button>
          <p className="muted" style={{ margin: 0 }}>
            {isRegister ? 'Already have an account? ' : 'New to LayerForge? '}
            <Link className="link" to={`/${isRegister ? 'login' : 'register'}${query}`}>{isRegister ? 'Log in' : 'Create an account'}</Link>
          </p>
        </form>
      </div>
      <aside className="auth-side" aria-hidden="true">
        <PrintModel shape={isRegister ? 'gear' : 'vase'} color={isRegister ? '#c9f23a' : '#ff5a2b'} print />
        <strong>{isRegister ? 'One account, every order.' : 'Pick up where you left off.'}</strong>
        <p>{isRegister ? 'Track deliveries, save your address, and cancel before shipping in a click.' : 'Your cart is kept on this device while you log in.'}</p>
      </aside>
    </div>
  );
}

export const Login = () => <AuthPage mode="login" />;
export const Register = () => <AuthPage mode="register" />;
