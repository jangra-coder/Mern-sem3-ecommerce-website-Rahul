import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, rupees } from '../api.js';
import { MAX_QTY, useAuth, useCart } from '../context.jsx';
import { ProductArt } from './Shop.jsx';

export function CartPage() {
  const cart = useCart();
  const { user } = useAuth();

  if (cart.items.length === 0) {
    return <div className="empty"><h2>Your cart is empty</h2><Link to="/" className="button">Browse the shop</Link></div>;
  }

  return (
    <>
      <h1>Your cart</h1>
      <div className="split">
        <div className="card list">
          {cart.items.map((item) => (
            <div key={item.id} className="line">
              <div className="thumb"><ProductArt category={item.category} color={item.color} /></div>
              <div className="line-info">
                <Link to={`/product/${item.id}`}>{item.name}</Link>
                <span className="muted">{rupees(item.price)} each</span>
              </div>
              <select aria-label={`Quantity of ${item.name}`} value={item.qty} onChange={(e) => cart.setQty(item.id, Number(e.target.value))}>
                {Array.from({ length: Math.max(item.qty, Math.min(MAX_QTY, item.stock ?? MAX_QTY)) }, (_, i) => (
                  <option key={i + 1}>{i + 1}</option>
                ))}
              </select>
              <strong className="line-total">{rupees(item.price * item.qty)}</strong>
              <button className="link-button" onClick={() => cart.remove(item.id)}>Remove</button>
            </div>
          ))}
        </div>
        <aside className="card summary">
          <div className="row"><span>Subtotal</span><strong>{rupees(cart.total)}</strong></div>
          <div className="row"><span>Delivery</span><span>Free</span></div>
          <Link to={user ? '/checkout' : '/login?next=%2Fcheckout'} className="button">
            {user ? 'Checkout' : 'Log in to checkout'}
          </Link>
        </aside>
      </div>
    </>
  );
}

export function Checkout() {
  const cart = useCart();
  const { user, loading, forget } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', phone: '', address: '', city: '', pincode: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState(null);

  if (placed) {
    return (
      <div className="empty">
        <h2>Order placed. Thank you!</h2>
        <p>Total {rupees(placed.total)} &middot; pay with cash on delivery.</p>
        <Link to="/orders" className="button">View my orders</Link>
      </div>
    );
  }
  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <Navigate to="/login?next=%2Fcheckout" replace />;
  if (cart.items.length === 0) return <Navigate to="/cart" replace />;

  const field = (key) => ({
    value: form[key],
    onChange: (e) => setForm({ ...form, [key]: e.target.value }),
    required: true,
  });

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return; // ignore double clicks
    setError('');
    setBusy(true);
    try {
      const { order } = await api('/orders', {
        method: 'POST',
        // Only ids and quantities are sent. The server looks up the prices.
        body: { items: cart.items.map((i) => ({ productId: i.id, qty: i.qty })), shipping: form },
      });
      cart.clear();
      setPlaced(order);
    } catch (err) {
      if (err.status === 401) {
        forget();
        return navigate('/login?next=%2Fcheckout');
      }
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Checkout</h1>
      <div className="split">
        <form className="card form wide" onSubmit={handleSubmit}>
          <h2>Delivery address</h2>
          {error && <p className="error" role="alert">{error} <Link to="/cart">Edit cart</Link></p>}
          <label>Full name<input {...field('fullName')} minLength={2} maxLength={80} autoComplete="name" /></label>
          <label>Mobile number<input {...field('phone')} inputMode="numeric" pattern="[6-9][0-9]{9}" title="10-digit mobile number" maxLength={10} autoComplete="tel-national" /></label>
          <label>Address<input {...field('address')} minLength={5} maxLength={200} autoComplete="street-address" /></label>
          <div className="two">
            <label>City<input {...field('city')} minLength={2} maxLength={60} autoComplete="address-level2" /></label>
            <label>PIN code<input {...field('pincode')} inputMode="numeric" pattern="[0-9]{6}" title="6-digit PIN code" maxLength={6} autoComplete="postal-code" /></label>
          </div>
          <p className="muted">Payment: cash on delivery. No card details are collected.</p>
          <button className="button" disabled={busy}>{busy ? 'Placing order…' : `Place order · ${rupees(cart.total)}`}</button>
        </form>
        <aside className="card summary">
          {cart.items.map((i) => (
            <div key={i.id} className="row"><span>{i.qty} × {i.name}</span><span>{rupees(i.price * i.qty)}</span></div>
          ))}
          <div className="row total"><span>Total</span><strong>{rupees(cart.total)}</strong></div>
        </aside>
      </div>
    </>
  );
}

export function Orders() {
  const { user, loading } = useAuth();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    api('/orders').then((data) => setOrders(data.orders)).catch((err) => setError(err.message));
  }, [user]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <Navigate to="/login?next=%2Forders" replace />;

  return (
    <>
      <h1>My orders</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!error && orders === null && <p className="muted">Loading…</p>}
      {orders?.length === 0 && <div className="empty"><p>You haven't ordered anything yet.</p><Link to="/" className="button">Browse the shop</Link></div>}
      {orders?.map((o) => (
        <div key={o._id} className="card order">
          <div className="row">
            <strong>Order #{o._id.slice(-6).toUpperCase()}</strong>
            <span className="muted">{new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
          {o.items.map((i) => (
            <div key={i.product} className="row"><span>{i.qty} × {i.name}</span><span>{rupees(i.price * i.qty)}</span></div>
          ))}
          <div className="row total">
            <span>{o.status} &middot; {o.paymentMethod}</span>
            <strong>{rupees(o.total)}</strong>
          </div>
          <p className="muted">Deliver to {o.shipping.fullName}, {o.shipping.address}, {o.shipping.city} {o.shipping.pincode}</p>
        </div>
      ))}
    </>
  );
}
