import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { api, rupees, shortId, when } from '../api.js';
import { useAuth, useConfig, useToast } from '../context.jsx';
import { payForOrder } from '../pay.js';
import { Empty, Loading, PaymentPill, StatusPill, useTitle } from '../components/ui.jsx';

const STEPS = ['Placed', 'Packed', 'Shipped', 'Delivered'];
const CAN_CANCEL = ['Pending payment', 'Placed', 'Packed'];

export function OrderList() {
  const { user, loading } = useAuth();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');
  useTitle('My orders');

  useEffect(() => {
    if (!user) return;
    api('/orders').then((d) => setOrders(d.orders)).catch((err) => setError(err.message));
  }, [user]);

  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login?next=%2Forders" replace />;

  return (
    <div className="wrap narrow">
      <header className="page-head">
        <p className="eyebrow">Account</p>
        <h1>My orders</h1>
      </header>
      {error && <p className="alert alert--bad" role="alert">{error}</p>}
      {!error && !orders && <Loading />}
      {orders?.length === 0 && (
        <Empty shape="planter" color="#3f8f6b" title="No orders yet." action={<Link to="/shop" className="btn btn--hot">Start shopping</Link>}>
          When you order something it will show up here with its delivery progress.
        </Empty>
      )}
      {orders?.length > 0 && (
        <div className="order-list">
          {orders.map((o) => (
            <Link key={o._id} to={`/orders/${o._id}`} className="order-row">
              <div>
                <strong>#{shortId(o._id)}</strong>
                <small>{when(o.createdAt)} · {o.items.reduce((n, i) => n + i.qty, 0)} items · {o.items.map((i) => i.name).join(', ')}</small>
              </div>
              <StatusPill status={o.status} />
              <span className="price">{rupees(o.total)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function minutesLeft(order, holdMinutes) {
  return Math.max(0, Math.ceil((new Date(order.createdAt).getTime() + holdMinutes * 60000 - Date.now()) / 60000));
}

export function OrderDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { user, loading } = useAuth();
  const { holdMinutes, razorpay } = useConfig();
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(location.state?.notice || '');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useTitle(order ? `Order #${shortId(order._id)}` : 'Order');

  const load = useCallback(
    () => api(`/orders/${encodeURIComponent(id)}`).then((d) => setOrder(d.order)).catch((err) => setError(err.message)),
    [id]
  );
  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // Keep the "pay within N minutes" count fresh.
  useEffect(() => {
    if (order?.status !== 'Pending payment') return;
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [order?.status]);

  if (loading) return <Loading />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (error) {
    return (
      <div className="wrap">
        <Empty shape="gear" color="#b5ac98" title="Order not found." action={<Link to="/orders" className="btn">All my orders</Link>}>{error}</Empty>
      </div>
    );
  }
  if (!order) return <Loading text="Loading order" />;

  async function payNow() {
    setBusy(true);
    setNotice('');
    try {
      const { order: fresh, payment } = await api(`/orders/${order._id}/pay`, { method: 'POST', body: {} });
      if (!payment) {
        setOrder(fresh);
        return;
      }
      setOrder(await payForOrder({ order: fresh, payment, user }));
      toast('Payment received. Thank you!');
    } catch (err) {
      if (!err.dismissed) setNotice(err.message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const paid = order.payment.status === 'paid';
    const ok = window.confirm(paid ? `Cancel this order? ${rupees(order.total)} will be refunded to your original payment method.` : 'Cancel this order?');
    if (!ok) return;
    setBusy(true);
    setNotice('');
    try {
      const { order: cancelled } = await api(`/orders/${order._id}/cancel`, { method: 'POST', body: {} });
      setOrder(cancelled);
      toast(cancelled.payment.status === 'refunded' ? 'Order cancelled and refunded.' : 'Order cancelled.');
    } catch (err) {
      setNotice(err.message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const pending = order.status === 'Pending payment';
  const cancelled = order.status === 'Cancelled';
  const stepIndex = STEPS.indexOf(order.status);
  const left = minutesLeft(order, holdMinutes);

  return (
    <div className="wrap narrow">
      <header className="page-head">
        <p className="eyebrow"><Link to="/orders" className="link link--quiet">My orders</Link> / #{shortId(order._id)}</p>
        <h1>{pending ? 'Waiting for payment' : cancelled ? 'Order cancelled' : order.status === 'Delivered' ? 'Delivered' : 'Order confirmed'}</h1>
        <p>Placed {when(order.createdAt)}</p>
      </header>

      <div className="rows" style={{ gap: 16 }}>
        {location.state?.placed && !pending && !cancelled && (
          <p className="alert alert--ok" role="status">Thank you! Your order is in. We'll pack it next.</p>
        )}
        {notice && <p className={`alert ${location.state?.pending ? 'alert--info' : 'alert--warn'}`} role="status">{notice}</p>}
        {pending && (
          <div className="alert alert--warn">
            {left > 0
              ? `Your items are held for ${left} more minute${left === 1 ? '' : 's'}. Pay before then, or the order is released and nothing is charged.`
              : 'The hold on this order is running out. If it has not been paid, it will be released shortly.'}
          </div>
        )}
        {['refunding', 'refund_failed'].includes(order.payment.status) || (cancelled && order.payment.status === 'paid') ? (
          <p className="alert alert--info">Your refund of {rupees(order.total)} is being processed. It usually reaches your account in 5–7 working days.</p>
        ) : null}
        {order.payment.status === 'refunded' && (
          <p className="alert alert--ok">{rupees(order.total)} has been refunded to your original payment method. Banks usually take 5–7 working days to show it.</p>
        )}

        {!cancelled && !pending && (
          <section className="panel">
            <ol className="tracker" aria-label="Delivery progress">
              {STEPS.map((s, i) => (
                <li key={s} className={`${i <= stepIndex ? 'done' : ''}${i === stepIndex ? ' now' : ''}`} aria-current={i === stepIndex ? 'step' : undefined}>
                  {s}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="panel">
          <div className="row" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Items</h2>
            <StatusPill status={order.status} />
          </div>
          <div className="rows">
            {order.items.map((i) => (
              <div key={i.product} className="row">
                <span>{i.qty} × <Link to={`/product/${i.product}`} className="link link--quiet">{i.name}</Link></span>
                <span className="price">{rupees(i.price * i.qty)}</span>
              </div>
            ))}
            <div className="row muted"><span>Delivery</span><span className="price">{order.shippingFee ? rupees(order.shippingFee) : 'Free'}</span></div>
            <div className="row row--total"><span>Total</span><span className="price">{rupees(order.total)}</span></div>
          </div>
        </section>

        <section className="panel">
          <dl className="kv">
            <dt>Deliver to</dt>
            <dd>{order.shipping.fullName}, {order.shipping.phone}<br />{order.shipping.address}, {order.shipping.city}, {order.shipping.state} {order.shipping.pincode}</dd>
            <dt>Payment</dt>
            <dd><PaymentPill status={order.payment.status} /> {order.payment.method === 'razorpay' ? 'Online (Razorpay)' : 'Cash on delivery'}</dd>
            {order.payment.razorpayPaymentId && (<><dt>Payment ID</dt><dd className="mono">{order.payment.razorpayPaymentId}</dd></>)}
          </dl>
        </section>

        <div className="order-actions">
          {pending && razorpay.enabled && (
            <button className="btn btn--hot" onClick={payNow} disabled={busy}>{busy ? 'Working…' : `Pay ${rupees(order.total)} now`}</button>
          )}
          {CAN_CANCEL.includes(order.status) && (
            <button className="btn btn--danger" onClick={cancel} disabled={busy}>Cancel order</button>
          )}
          <Link to="/shop" className="btn btn--ghost">Keep shopping</Link>
        </div>
      </div>
    </div>
  );
}
