import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context.jsx';

// Where to go after logging in. Only pages inside this site are allowed,
// so a crafted link can't bounce people to another website.
export function useNextPath() {
  const next = useSearchParams()[0].get('next') || '/';
  return next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
}

function AccountForm({ mode }) {
  const isRegister = mode === 'register';
  const { user, loading, login, register } = useAuth();
  const next = useNextPath();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={next} replace />;

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (isRegister && form.password !== form.confirm) {
      return setError('The two passwords do not match.');
    }
    setBusy(true);
    try {
      if (isRegister) await register(form.name, form.email, form.password);
      else await login(form.email, form.password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const other = isRegister ? 'login' : 'register';
  const query = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;

  return (
    <form className="card form" onSubmit={handleSubmit}>
      <h1>{isRegister ? 'Create your account' : 'Log in'}</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {isRegister && (
        <label>Name
          <input {...field('name')} required minLength={2} maxLength={50} autoComplete="name" />
        </label>
      )}
      <label>Email
        <input type="email" {...field('email')} required maxLength={254} autoComplete="email" />
      </label>
      <label>Password
        <input type="password" {...field('password')} required minLength={isRegister ? 8 : 1} maxLength={72}
          autoComplete={isRegister ? 'new-password' : 'current-password'} />
        {isRegister && <small>At least 8 characters, with a letter and a number.</small>}
      </label>
      {isRegister && (
        <label>Confirm password
          <input type="password" {...field('confirm')} required maxLength={72} autoComplete="new-password" />
        </label>
      )}
      <button className="button" disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}</button>
      <p className="muted">
        {isRegister ? 'Already have an account? ' : 'New here? '}
        <Link to={`/${other}${query}`}>{isRegister ? 'Log in' : 'Create an account'}</Link>
      </p>
    </form>
  );
}

export const Login = () => <AccountForm mode="login" />;
export const Register = () => <AccountForm mode="register" />;
