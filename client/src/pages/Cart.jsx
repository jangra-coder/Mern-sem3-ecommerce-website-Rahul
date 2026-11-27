import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, rupees } from '../api.js';
import { useAuth, useCart, useConfig } from '../context.jsx';
import { PrintModel } from '../components/PrintModel.jsx';
import { Empty, QtyStepper, useTitle } from '../components/ui.jsx';
import { imageUrl } from '../api.js';

export function Thumb({ item, small = false }) {
  return (
    <div className={`thumb${small ? ' thumb--sm' : ''}`}>
      {item.imageVersion ? <img src={imageUrl({ _id: item.id, imageVersion: item.imageVersion })} alt="" /> : <PrintModel shape={item.shape} color={item.color} />}
    </div>
  );
}

// "Add ₹X more for free delivery", drawn as a row of print layers.
export function FreeDeliveryBar({ subtotal }) {
  const { shipping } = useConfig();
  const left = shipping.freeAbove - subtotal;
  const filled = Math.min(20, Math.round((subtotal / shipping.freeAbove) * 20));
  return (
    <div className="freebar">
      <span>{left > 0 ? <>Add <b>{rupees(left)}</b> more for free delivery.</> : <b>Your order ships free.</b>}</span>
      <div className="layers-meter" aria-hidden="true">
        {Array.from({ length: 20 }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}
      </div>
    </div>
  );
}

export function Totals({ subtotal }) {
  const { shipping } = useConfig();
  const fee = subtotal >= shipping.freeAbove ? 0 : shipping.fee;
  return (
    <div className="rows">
      <div className="row"><span>Subtotal</span><span className="price">{rupees(subtotal)}</span></div>
      <div className="row"><span>Delivery</span><span className="price">{fee ? rupees(fee) : 'Free'}</span></div>
      <div className="row row--total"><span>Total</span><span className="price">{rupees(subtotal + fee)}</span></div>
    </div>
  );
}

export default function CartPage() {
  const cart = useCart();
  const { user } = useAuth();
  const { maxQty } = useConfig();
  const [notes, setNotes] = useState([]);
  useTitle('Cart');

  // Prices and stock may have changed since things were added.
  useEffect(() => {
    if (cart.items.length === 0) return;
    api('/products')
      .then(({ products }) => setNotes(cart.sync(products)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (cart.items.length === 0) {
    return (
      <div className="wrap">
        <Empty shape="spool" color="#d8d0bf" title="Your cart is empty." action={<Link to="/shop" className="btn btn--hot">Browse the shop <span className="arrow">→</span></Link>}>
          {notes.length > 0 ? notes.join(' ') : 'Nothing on the spool yet.'}
        </Empty>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="page-head">
        <p className="eyebrow">Cart</p>
        <h1>{cart.count} {cart.count === 1 ? 'item' : 'items'}</h1>
      </header>

      {notes.length > 0 && (
        <div className="alert alert--warn" role="status" style={{ marginBottom: 20 }}>
          Your cart was updated: {notes.join(' ')}
        </div>
      )}

      <div className="split">
        <div className="lines">
          {cart.items.map((item) => (
            <div key={item.id} className="line">
              <Link to={`/product/${item.id}`} tabIndex={-1} aria-hidden="true"><Thumb item={item} /></Link>
              <div>
                <Link to={`/product/${item.id}`} className="line-name">{item.name}</Link>
                <div className="line-meta">
                  <span>{rupees(item.price)} each</span>
                  <button className="link link--quiet" onClick={() => cart.remove(item.id)}>Remove</button>
                </div>
              </div>
              <QtyStepper small value={item.qty} max={Math.min(maxQty, item.stock ?? maxQty)} onChange={(q) => cart.setQty(item.id, q)} label={`Quantity of ${item.name}`} />
              <span className="price line-total">{rupees(item.price * item.qty)}</span>
            </div>
          ))}
        </div>

        <aside className="panel sticky">
          <h2>Summary</h2>
          <div className="rows">
            <FreeDeliveryBar subtotal={cart.subtotal} />
            <Totals subtotal={cart.subtotal} />
            <Link to={user ? '/checkout' : '/login?next=%2Fcheckout'} className="btn btn--hot btn--block" style={{ marginTop: 8 }}>
              {user ? 'Checkout' : 'Log in to check out'} <span className="arrow">→</span>
            </Link>
            <Link to="/shop" className="link link--quiet" style={{ textAlign: 'center' }}>Keep shopping</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
