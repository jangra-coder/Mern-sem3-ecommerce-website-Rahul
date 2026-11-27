import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, useToast } from '../context.jsx';
import { AddressFields, emptyAddress } from '../components/AddressFields.jsx';
import { Loading, useTitle } from '../components/ui.jsx';
import { PasswordInput, PasswordRules } from './Auth.jsx';

export default function Account() {
  const { user, loading } = useAuth();
  useTitle('Account');
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login?next=%2Faccount" replace />;
  // Only start the forms once we know who is logged in, so they fill in correctly.
  return <AccountForms user={user} />;
}

function AccountForms({ user }) {
  const { setUser, forget } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [address, setAddress] = useState(user.address || emptyAddress);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState('');

  async function run(key, work, success) {
    setErrors((e) => ({ ...e, [key]: '' }));
    setBusy(key);
    try {
      await work();
      toast(success);
      return true;
    } catch (err) {
      setErrors((e) => ({ ...e, [key]: err.message }));
      return false;
    } finally {
      setBusy('');
    }
  }

  const saveProfile = (body, key, message) =>
    run(key, async () => setUser((await api('/auth/profile', { method: 'PATCH', body })).user), message);

  return (
    <div className="wrap narrow">
      <header className="page-head">
        <p className="eyebrow">Account</p>
        <h1>Hi, {user.name.split(' ')[0]}.</h1>
        <p>{user.email} · <Link to="/orders" className="link">My orders →</Link></p>
      </header>

      <form className="panel form" onSubmit={(e) => { e.preventDefault(); saveProfile({ name }, 'name', 'Name updated.'); }}>
        <h2>Your name</h2>
        {errors.name && <p className="alert alert--bad" role="alert">{errors.name}</p>}
        <div className="field-row">
          <label className="field" style={{ flex: 1 }}>
            <span className="sr-only">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={50} autoComplete="name" />
          </label>
          <button className="btn" disabled={busy === 'name' || name.trim() === user.name}>Save</button>
        </div>
      </form>

      <form className="panel form" onSubmit={(e) => { e.preventDefault(); saveProfile({ address }, 'address', 'Address saved.'); }}>
        <h2>Delivery address</h2>
        <p className="muted" style={{ margin: '-8px 0 0' }}>Filled in for you at checkout.</p>
        {errors.address && <p className="alert alert--bad" role="alert">{errors.address}</p>}
        <AddressFields value={address} onChange={setAddress} />
        <div className="field-row">
          <button className="btn" disabled={busy === 'address'}>Save address</button>
          {user.address && (
            <button type="button" className="link link--quiet" onClick={() => saveProfile({ address: null }, 'address', 'Saved address removed.').then((ok) => ok && setAddress(emptyAddress))}>
              Remove saved address
            </button>
          )}
        </div>
      </form>

      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          run('password', async () => {
            await api('/auth/password', { method: 'POST', body: pw });
            setPw({ currentPassword: '', newPassword: '' });
          }, 'Password changed. Other devices have been logged out.');
        }}
      >
        <h2>Change password</h2>
        {errors.password && <p className="alert alert--bad" role="alert">{errors.password}</p>}
        <div className="form-grid">
          <PasswordInput label="Current password" name="currentPassword" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />
          <PasswordInput label="New password" name="newPassword" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} minLength={8} autoComplete="new-password" />
        </div>
        <PasswordRules password={pw.newPassword} />
        <div><button className="btn" disabled={busy === 'password'}>Change password</button></div>
      </form>

      <section className="panel form">
        <h2>Devices</h2>
        <p className="muted" style={{ margin: '-8px 0 0' }}>Logged in on a computer that isn't yours, or lost a phone? This logs you out everywhere, including here.</p>
        {errors.devices && <p className="alert alert--bad" role="alert">{errors.devices}</p>}
        <div>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy === 'devices'}
            onClick={() => {
              if (!window.confirm('Log out of LayerForge on every device, including this one?')) return;
              run('devices', async () => {
                await api('/auth/logout-all', { method: 'POST', body: {} });
                forget();
              }, 'Logged out everywhere.');
            }}
          >
            Log out of all devices
          </button>
        </div>
      </section>
    </div>
  );
}
