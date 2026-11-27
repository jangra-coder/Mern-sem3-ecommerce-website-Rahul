// Small building blocks used on many pages.
import { Component, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CATEGORY_CODES, imageUrl } from '../api.js';
import { PrintModel } from './PrintModel.jsx';

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — LayerForge` : 'LayerForge — 3D printers, filament & parts';
  }, [title]);
}

export function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const update = () => setReduced(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

// New page: start at the top (but keep the position when only filters change).
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Braces matter: newer Chrome returns a Promise from scrollTo, and React
    // would try to run anything an effect returns as its clean-up.
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export const productCode = (p) => `${CATEGORY_CODES[p.category] || 'LF'}-${String(p._id).slice(-4).toUpperCase()}`;

// The uploaded photo if there is one, otherwise the drawn model.
export function ProductVisual({ product, print = false, label }) {
  const [broken, setBroken] = useState(false);
  if (product.imageVersion && !broken) {
    return <img src={imageUrl(product)} alt={label ?? product.name} loading="lazy" decoding="async" onError={() => setBroken(true)} />;
  }
  return <PrintModel shape={product.shape} color={product.color} print={print} label={label} />;
}

export function StockTag({ stock }) {
  if (stock === 0) return <span className="stock stock--out">Sold out</span>;
  if (stock <= 5) return <span className="stock stock--low">Only {stock} left</span>;
  return <span className="stock stock--ok">In stock</span>;
}

export function QtyStepper({ value, max, onChange, label = 'Quantity', small = false }) {
  return (
    <div className={`stepper${small ? ' stepper--sm' : ''}`} role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="One fewer">−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="One more">+</button>
    </div>
  );
}

export function Loading({ text = 'Loading' }) {
  return (
    <div className="loading" role="status">
      <span className="loading-bar" aria-hidden="true" />
      {text}…
    </div>
  );
}

export function Empty({ shape = 'vase', color = '#d8d0bf', title, children, action }) {
  return (
    <div className="empty">
      <PrintModel shape={shape} color={color} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export const STATUS_CLASS = {
  'Pending payment': 'pending', Placed: 'placed', Packed: 'packed', Shipped: 'shipped', Delivered: 'delivered', Cancelled: 'cancelled',
};
export const PAYMENT_LABEL = {
  cod: 'Cash on delivery',
  pending: 'Awaiting payment',
  paid: 'Paid',
  refunding: 'Refund in progress',
  refunded: 'Refunded',
  refund_failed: 'Refund in progress',
  void: 'Not charged',
};

export const StatusPill = ({ status }) => <span className={`pill pill--${STATUS_CLASS[status] || 'placed'}`}>{status}</span>;
export const PaymentPill = ({ status, admin = false }) => (
  <span className={`pill pill--${status}`}>{admin && status === 'refund_failed' ? 'Refund failed' : PAYMENT_LABEL[status] || status}</span>
);

// Stops one broken page from blanking the whole site.
export class ErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error(error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="wrap">
        <Empty shape="gear" color="#b5ac98" title="Something jammed." action={<Link className="btn" to="/">Back to the shop</Link>}>
          This page hit an error. Reloading usually clears it.
        </Empty>
      </div>
    );
  }
}
