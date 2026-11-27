import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, rupees } from '../api.js';
import { useAuth, useCart, useConfig, useToast } from '../context.jsx';
import { payForOrder } from '../pay.js';
import { AddressFields, emptyAddress } from '../components/AddressFields.jsx';
import { Loading, useTitle } from '../components/ui.jsx';
import { FreeDeliveryBar, Thumb, Totals } from './Cart.jsx';

export default function Checkout() {
  const { user, loading } = useAuth();
  useTitle('Checkout');
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login?next=%2Fcheckout" replace />;
  // Only start the form once we know who is logged in, so the saved address fills in.
  return <CheckoutForm user={user} />;
}

function CheckoutForm({ user }) {
  const cart = useCart();
  const { forget, setUser } = useAuth();
  const { razorpay } = useConfig();
  const toast = useToast();
  const navigate = useNavigate();
  const [address, setAddress] = useState(user.address || emptyAddress);
  const [method, setMethod] = useState(null); // null = the default for this shop
  const [saveAddress, setSaveAddress] = useState(!user.address);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Once the order exists the cart is emptied, but the page should keep
  // showing what is being paid for while the payment window is open.
  const [snapshot, setSnapshot] = useState(null);

  if (cart.items.length === 0 && !snapshot) return <Navigate to="/cart" replace />;

  const payWith = method ?? (razorpay.enabled ? 'razorpay' : 'cod');
  const items = snapshot?.items ?? cart.items;
  const subtotal = snapshot?.subtotal ?? cart.subtotal;

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return; // ignore double clicks
    setError('');
    setBusy(true);
    let placed;
    try {
      placed = await api('/orders', {
        method: 'POST',
        // Only ids and quantities are sent. The server looks up every price.
        body: { items: cart.items.map((i) => ({ productId: i.id, qty: i.qty })), shipping: address, paymentMethod: payWith, saveAddress },
      });
    } catch (err) {
      setBusy(false);
      if (err.status === 401) {
        forget();
        return navigate('/login?next=%2Fcheckout');
      }
      return setError(err.message);
    }

    setSnapshot({ items: cart.items, subtotal: cart.subtotal });
    cart.clear();
    if (saveAddress) setUser((u) => (u ? { ...u, address } : u));
    const { order, payment } = placed;

    if (!payment) {
      toast('Order placed. Thank you!');
      return navigate(`/orders/${order._id}`, { replace: true, state: { placed: true } });
    }
    try {
      await payForOrder({ order, payment, user });
      toast('Payment received. Thank you!');
      navigate(`/orders/${order._id}`, { replace: true, state: { placed: true } });
    } catch (err) {
      // The order is kept (and its stock held) so it can be paid from the order page.
      navigate(`/orders/${order._id}`, { replace: true, state: { notice: err.message, pending: Boolean(err.pending) } });
    }
  }

  return (
    <div className="wrap">
      <header className="page-head">
        <p className="eyebrow">Checkout</p>
        <h1>Almost there.</h1>
      </header>

      <form className="split" onSubmit={handleSubmit}>
        <div>
          <section className="panel">
            <div className="step-title"><b>1</b><h2>Delivery address</h2></div>
            <AddressFields value={address} onChange={setAddress} />
            <label className="check" style={{ marginTop: 16 }}>
              <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
              Save this address for next time
            </label>
          </section>

          <section className="panel">
            <div className="step-title"><b>2</b><h2>Payment</h2></div>
            <div className="pay-opts" role="radiogroup" aria-label="Payment method">
              {razorpay.enabled && (
                <label className="pay-opt">
                  <input type="radio" name="pay" value="razorpay" checked={payWith === 'razorpay'} onChange={() => setMethod('razorpay')} />
                  <div>
                    <strong>Pay online now</strong>
                    <span>A secure Razorpay window opens. We never see your card or UPI details.</span>
                    <div className="tags"><em>UPI</em><em>Cards</em><em>Netbanking</em><em>Wallets</em></div>
                  </div>
                </label>
              )}
              <label className="pay-opt">
                <input type="radio" name="pay" value="cod" checked={payWith === 'cod'} onChange={() => setMethod('cod')} />
                <div>
                  <strong>Cash on delivery</strong>
                  <span>Pay the courier when your parcel arrives.</span>
                </div>
              </label>
            </div>
          </section>
        </div>

        <aside className="panel sticky">
          <h2>Your order</h2>
          <div className="rows">
            {items.map((i) => (
              <div key={i.id} className="row" style={{ alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Thumb item={i} small />
                  <span>{i.qty} × {i.name}</span>
                </span>
                <span className="price">{rupees(i.price * i.qty)}</span>
              </div>
            ))}
            <FreeDeliveryBar subtotal={subtotal} />
            <Totals subtotal={subtotal} />
            {error && (
              <p className="alert alert--bad" role="alert">
                {error} {/stock|available|sold/i.test(error) && <Link to="/cart">Review your cart</Link>}
              </p>
            )}
            <button className="btn btn--hot btn--block" disabled={busy || Boolean(snapshot)}>
              {busy || snapshot ? 'Working…' : payWith === 'razorpay' ? 'Pay securely' : 'Place order'}
            </button>
            <p className="fine">
              By placing this order you agree to our <Link to="/terms" className="link">Terms</Link>,{' '}
              <Link to="/refunds" className="link">Refund policy</Link> and{' '}
              <Link to="/privacy" className="link">Privacy policy</Link>.{' '}
              {payWith === 'razorpay'
                ? 'Prices are checked again on our side before you pay. If you close the payment window, your order waits for you under My orders.'
                : 'You can cancel from your orders page until it ships.'}
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}
